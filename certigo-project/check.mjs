#!/usr/bin/env node
// Локальная проверка аналитического пакета CertiGo.
// Скрипт создаёт и затем удаляет временную базу на указанном PostgreSQL-сервере.

import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const SUB = path.join(KIT, 'submission');

const PASS_SCORE = 60;
const TMP_DB = 'certigo_check_tmp';

// Контрольные сигнатуры не содержат готовых запросов и значений.
const EXPECTED_SQL = {
  channels: { columns: 2, digest: '2262b073483f32dea1f45348b6eef8415d4fcae5aa3675110e25cacaa5c1d99e' },
  funnel: { columns: 10, digest: '7819a018193d4b21ce0618510842094b95749c2df4536840abf1972b2aa4e010' },
  ab_primary: { columns: 4, digest: '8df312de85e2c7457d08de9db9ef3cd2930f8f09c0653dff408fdb3af3a0037a' },
  ab_guardrail: { columns: 5, digest: '64d6d7e2592200834fe476d0ee690e7745d8d9e993f9e00e79f8e732391600bb' },
  economics: { columns: 8, digest: '088a4094a202c05f60e1d72df8135042ec8954424cd6b849a43470856ba139ee' },
};

const EXPECTED_EXPORTS = {
  funnel: '36347cc38fd4e92ddac1f7417dee6f50a6a74275e0f0573b78df1501fbd8ace2',
  ab_onboarding: '1d48e2c28443038c823bf7a5443a1bf0290d65d3803e02d4f78d24ce3d8a1427',
  economics: '3d9cf74c8ec794a1873acce06877b4d7c1b468088d470b27bccba49af2f8b3d6',
  revenue_weekly: 'af6246782f50c8e62aa66594640dc8edda9037419fae1c88c1c8958e97bd5f41',
};

const TASK_LABELS = {
  channels: 'SQL · новые пользователи по каналам',
  funnel: 'SQL · воронка продукта',
  ab_primary: 'A/B-тест · основная метрика (завершение онбординга)',
  ab_guardrail: 'A/B-тест · guardrail (оплаты)',
  economics: 'Юнит-экономика · платные каналы',
};

const results = [];

function report(section, points, maxPoints, ok, message) {
  results.push({ section, points, maxPoints, ok, message });
}

// Числа и даты приводятся к устойчивому виду перед сравнением.
function normCell(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'number') return String(Math.round(value * 1000) / 1000);

  const text = String(value).trim();
  if (text !== '' && !Number.isNaN(Number(text))) {
    return String(Math.round(Number(text) * 1000) / 1000);
  }
  return text;
}

function normRows(rows) {
  return rows.map((row) => row.map(normCell).join('|')).sort();
}

function digestRows(rows) {
  return createHash('sha256').update(normRows(rows).join('\n')).digest('hex');
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function stableJson(value) {
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  if (value && typeof value === 'object') {
    return '{' + Object.keys(value).sort()
      .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
      .join(',') + '}';
  }
  return JSON.stringify(value);
}

async function runQuery(db, sql) {
  const result = await db.query(sql);
  const columns = result.fields.map((field) => field.name);
  return { columns, rows: result.rows.map((row) => columns.map((column) => row[column])) };
}

async function checkSql(db) {
  for (const key of Object.keys(TASK_LABELS)) {
    const label = TASK_LABELS[key];
    const file = path.join(SUB, key + '.sql');
    const max = 10;

    if (!existsSync(file)) {
      report(label, 0, max, false, 'файл submission/' + key + '.sql не найден');
      continue;
    }

    const sql = readFileSync(file, 'utf8').trim();
    if (!sql || sql.split('\n').every((line) => line.trim().startsWith('--') || !line.trim())) {
      report(label, 0, max, false, 'submission/' + key + '.sql пуст — добавьте читающий запрос');
      continue;
    }

    let actual;
    try {
      actual = await runQuery(db, sql);
    } catch (error) {
      report(label, 0, max, false, 'запрос не выполнился (' + String(error.message).split('\n')[0] + ')');
      continue;
    }

    const expected = EXPECTED_SQL[key];
    if (actual.columns.length !== expected.columns) {
      report(label, 0, max, false, 'число колонок не соответствует форме ожидаемого результата');
      continue;
    }
    if (digestRows(actual.rows) !== expected.digest) {
      report(label, 0, max, false, 'результат не совпал с контрольным — проверьте фильтры, соединения и знаменатель');
      continue;
    }

    report(label, max, max, true, 'результат совпал с контрольным');
  }
}

function reportSqlUnavailable(reason) {
  for (const key of Object.keys(TASK_LABELS)) {
    report(TASK_LABELS[key], 0, 10, false, 'проверка не выполнена: ' + reason);
  }
}

function readJson(file, displayPath) {
  if (!existsSync(file)) return { error: 'файл ' + displayPath + ' не найден' };
  try {
    return { data: JSON.parse(readFileSync(file, 'utf8')) };
  } catch {
    return { error: displayPath + ' — невалидный JSON' };
  }
}

function loadJsonExport(name) {
  const submissionPath = path.join(SUB, 'exports', name);
  const dashboardPath = path.join(KIT, 'dashboard', 'exports', name);
  const submitted = readJson(submissionPath, 'submission/exports/' + name);
  if (submitted.error) return submitted;

  const dashboard = readJson(dashboardPath, 'dashboard/exports/' + name);
  if (dashboard.error) return dashboard;
  if (stableJson(submitted.data) !== stableJson(dashboard.data)) {
    return { error: 'версии submission/exports/' + name + ' и dashboard/exports/' + name + ' различаются' };
  }
  return submitted;
}

function checkExports() {
  const max = 5;

  {
    const label = 'Экспорт funnel.json · блок воронки';
    const loaded = loadJsonExport('funnel.json');
    if (loaded.error) {
      report(label, 0, max, false, loaded.error);
    } else {
      const expectedStages = ['registration', 'onboarding_completed', 'trial_started', 'paywall_viewed', 'paid'];
      const stages = loaded.data && loaded.data.stages;
      const structureOk = Array.isArray(stages) && stages.length === expectedStages.length
        && stages.every((stage, index) => stage
          && stage.stage === expectedStages[index]
          && isFiniteNumber(stage.users));
      const valuesOk = structureOk
        && digestRows(stages.map((stage) => [stage.users])) === EXPECTED_EXPORTS.funnel;
      report(label, valuesOk ? max : 0, max, valuesOk,
        structureOk
          ? 'числа пользователей на этапах не совпали с воронкой'
          : 'нужен массив stages из пяти этапов с полями stage и users');
    }
  }

  {
    const label = 'Экспорт ab_onboarding.json · блок A/B-теста';
    const loaded = loadJsonExport('ab_onboarding.json');
    if (loaded.error) {
      report(label, 0, max, false, loaded.error);
    } else {
      const variants = loaded.data && loaded.data.variants;
      const expectedVariants = new Set(['A', 'B']);
      const structureOk = Array.isArray(variants) && variants.length === 2
        && new Set(variants.map((variant) => variant && variant.variant)).size === 2
        && variants.every((variant) => variant
          && expectedVariants.has(variant.variant)
          && isFiniteNumber(variant.assigned_users)
          && isFiniteNumber(variant.completion_rate)
          && isFiniteNumber(variant.payment_rate));
      const valuesOk = structureOk
        && digestRows(variants.map((variant) => [
          variant.variant,
          variant.assigned_users,
          variant.completion_rate,
          variant.payment_rate,
        ])) === EXPECTED_EXPORTS.ab_onboarding;
      report(label, valuesOk ? max : 0, max, valuesOk,
        structureOk
          ? 'метрики вариантов не совпали с A/B-проверками'
          : 'нужен массив variants для вариантов A и B с обязательными числовыми полями');
    }
  }

  {
    const label = 'Экспорт economics.json · блок юнит-экономики';
    const loaded = loadJsonExport('economics.json');
    if (loaded.error) {
      report(label, 0, max, false, loaded.error);
    } else {
      const channels = loaded.data && loaded.data.channels;
      const expectedChannels = new Set(['search_ads', 'social_ads']);
      const structureOk = Array.isArray(channels) && channels.length === 2
        && new Set(channels.map((channel) => channel && channel.channel_code)).size === 2
        && channels.every((channel) => channel
          && expectedChannels.has(channel.channel_code)
          && isFiniteNumber(channel.cac_rub)
          && isFiniteNumber(channel.arpu_rub)
          && isFiniteNumber(channel.romi));
      const valuesOk = structureOk
        && digestRows(channels.map((channel) => [
          channel.channel_code,
          channel.cac_rub,
          channel.arpu_rub,
          channel.romi,
        ])) === EXPECTED_EXPORTS.economics;
      report(label, valuesOk ? max : 0, max, valuesOk,
        structureOk
          ? 'CAC, ARPU или ROMI не совпали с расчётом юнит-экономики'
          : 'нужен массив channels для двух платных каналов с CAC, ARPU и ROMI');
    }
  }

  {
    const label = 'Экспорт revenue_weekly.json · блок выручки по неделям';
    const loaded = loadJsonExport('revenue_weekly.json');
    if (loaded.error) {
      report(label, 0, max, false, loaded.error);
    } else {
      const weeks = loaded.data && loaded.data.weeks;
      const structureOk = Array.isArray(weeks) && weeks.length > 0
        && weeks.every((week) => week
          && typeof week.week === 'string'
          && /^\d{4}-W\d{2}$/.test(week.week)
          && isFiniteNumber(week.revenue_rub));
      const valuesOk = structureOk
        && digestRows(weeks.map((week) => [week.week, week.revenue_rub])) === EXPECTED_EXPORTS.revenue_weekly;
      report(label, valuesOk ? max : 0, max, valuesOk,
        structureOk
          ? 'выручка по неделям не совпала с контрольным результатом'
          : 'нужен массив weeks с полями week и revenue_rub');
    }
  }
}

function checkReleaseDecision() {
  const label = 'release-decision.md · решение';
  const file = path.join(SUB, 'release-decision.md');
  if (!existsSync(file)) {
    report(label, 0, 20, false, 'файл submission/release-decision.md не найден');
    return;
  }

  const text = readFileSync(file, 'utf8');
  const firstContentLine = text.replace(/^\uFEFF/, '').split('\n')
    .find((line) => line.trim()) || '';
  const notes = [];
  let points = 0;

  if (/^status:\s*(rollout|hold|rework)\s*$/i.test(firstContentLine)) {
    points += 3;
  } else {
    notes.push('в первой непустой строке укажите status: rollout, hold или rework');
  }

  const sections = [
    ['область решения', /област[ьи]\s+решени|границ[аы]\s+решени/i],
    ['доказательства', /доказательств/i],
    ['решение по эксперименту', /решени[ея]\s+по\s+(?:эксперимент|onboarding)/i],
    ['решение по бюджету', /решени[ея]\s+по\s+(?:бюджет|канал)/i],
    ['ограничения', /ограничени/i],
    ['следующая проверка', /следующ\w*\s+провер/i],
    ['след применения ИИ', /след[\s\S]{0,40}(?:ии|ai)/i],
  ];
  const missing = sections.filter(([, pattern]) => !pattern.test(text)).map(([name]) => name);
  points += 2 * (sections.length - missing.length);
  if (missing.length) notes.push('не найдены разделы: ' + missing.join(', '));

  const refs = new Set(
    [...text.matchAll(/\b(channels|funnel|ab_primary|ab_guardrail|economics)\.sql\b/gi)]
      .map((match) => match[1].toLowerCase()),
  );
  if (/(CONTROL|data-rules|ab-brief)/i.test(text)) refs.add('docs');
  if (refs.size >= 3) {
    points += 3;
  } else {
    notes.push('нужно добавить связи утверждений с источниками');
  }

  report(label, points, 20, points === 20,
    points === 20 ? 'структура и связи с источниками в порядке' : notes.join('; '));
}

function checkNotes() {
  const label = 'notes.md · постановка решения';
  const file = path.join(SUB, 'notes.md');
  if (!existsSync(file)) {
    report(label, 0, 10, false, 'файл submission/notes.md не найден');
    return;
  }

  const text = readFileSync(file, 'utf8').toLowerCase();
  const body = text.split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && !/^\{.*\}$/.test(line))
    .join(' ');
  const hasContent = body.length >= 150;
  const fields = [
    ['вопрос решения', /вопрос/],
    ['критерий решения', /критери/],
    ['период', /период/],
    ['сегмент', /сегмент/],
    ['ограничения', /ограничени/],
  ];
  const missing = fields.filter(([, pattern]) => !pattern.test(body)).map(([name]) => name);
  const points = hasContent ? 2 * (fields.length - missing.length) : 0;
  const details = [];
  if (!hasContent) details.push('файл не заполнен: добавьте содержательное описание');
  if (hasContent && missing.length) details.push('не найдены элементы: ' + missing.join(', '));

  report(label, points, 10, points === 10,
    points === 10 ? 'все элементы постановки зафиксированы' : details.join('; '));
}

function printResults(setupError) {
  let total = 0;
  for (const result of results) {
    total += result.points;
    const mark = result.ok ? 'OK ' : 'FAIL';
    console.log('[' + mark + '] ' + String(result.points).padStart(2) + '/' + result.maxPoints
      + '  ' + result.section);
    if (!result.ok) console.log('       → ' + result.message);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('Итог: ' + total + '/100. Зачёт: от ' + PASS_SCORE + ' баллов.');
  if (!setupError && total >= PASS_SCORE) {
    console.log('ЗАЧЁТ. Пакет можно передавать.');
  } else {
    console.log('НЕЗАЧЁТ. Исправьте отмеченные разделы и запустите проверку снова.');
  }

  return total;
}

async function main() {
  console.log('Проверка аналитического пакета CertiGo\n');

  let setupError = '';
  let connectionString = '';
  let db;
  let admin;
  let tmpDatabaseCreated = false;

  try {
    const configPath = path.join(KIT, 'check.config.json');
    if (!existsSync(configPath)) {
      throw new Error('не найден check.config.json; создайте его из check.config.example.json и укажите подключение к PostgreSQL');
    }

    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    if (!config.connectionString || typeof config.connectionString !== 'string') {
      throw new Error('в check.config.json нет строки connectionString');
    }
    connectionString = config.connectionString;

    admin = new Client({ connectionString });
    await admin.connect();
    await admin.query('DROP DATABASE IF EXISTS ' + TMP_DB);
    await admin.query('CREATE DATABASE ' + TMP_DB);
    tmpDatabaseCreated = true;
    await admin.end();
    admin = undefined;

    const tmpUrl = new URL(connectionString);
    tmpUrl.pathname = '/' + TMP_DB;
    db = new Client({ connectionString: tmpUrl.toString() });
    await db.connect();
    await db.query("SET TIME ZONE 'Europe/Moscow'");
    await db.query(readFileSync(path.join(KIT, 'schema.sql'), 'utf8'));
    await db.query(readFileSync(path.join(KIT, 'seed.sql'), 'utf8'));
    await checkSql(db);
  } catch (error) {
    const message = String(error.message || '');
    setupError = message.includes('check.config.json')
      ? message
      : 'не удалось подготовить временную базу; проверьте подключение, права CREATEDB и работу PostgreSQL';
  } finally {
    if (db) await db.end().catch(() => {});
    if (admin) await admin.end().catch(() => {});
    if (tmpDatabaseCreated && connectionString) {
      const cleanup = new Client({ connectionString });
      try {
        await cleanup.connect();
        await cleanup.query('DROP DATABASE IF EXISTS ' + TMP_DB);
      } catch {
        // Ошибка очистки не должна скрывать результат основной проверки.
      } finally {
        await cleanup.end().catch(() => {});
      }
    }
  }

  if (setupError) {
    console.error('Среда проверки: ' + setupError + '\n');
    reportSqlUnavailable(setupError);
  }

  checkExports();
  checkReleaseDecision();
  checkNotes();

  const total = printResults(setupError);
  process.exit(!setupError && total >= PASS_SCORE ? 0 : 1);
}

main().catch((error) => {
  console.error(String(error.message));
  process.exit(1);
});
