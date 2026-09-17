# Проверка загрузки базы CertiGo

Этот файл нужен до начала анализа: он подтверждает, что база собрана из `schema.sql` и `seed.sql` без пропусков. Здесь нет результатов аналитических запросов и чисел для дашборда.

После подготовки результатов запускайте `node check.mjs`. Команда создаёт чистую временную базу и выводит состояние каждого раздела.

## Ожидаемые количества строк

| Таблица | Строк |
|---|---:|
| `channels` | 3 |
| `marketing_spend` | 6 |
| `users` | 7080 |
| `ab_assignments` | 5040 |
| `events` | 22979 |
| `payments` | 647 |

## Предварительная проверка

Выполните весь блок после `schema.sql` и `seed.sql`. Все шесть результатов должны совпасть с таблицей выше.

```sql
SELECT 'channels' AS table_name, COUNT(*) AS row_count FROM channels
UNION ALL
SELECT 'marketing_spend', COUNT(*) FROM marketing_spend
UNION ALL
SELECT 'users', COUNT(*) FROM users
UNION ALL
SELECT 'ab_assignments', COUNT(*) FROM ab_assignments
UNION ALL
SELECT 'events', COUNT(*) FROM events
UNION ALL
SELECT 'payments', COUNT(*) FROM payments;
```

Если количества не совпали, выполните `reset.sql`, затем снова `seed.sql` и повторите проверку.
