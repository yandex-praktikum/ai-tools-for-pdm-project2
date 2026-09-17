# JSON-экспорты дашборда

Заполняйте эти четыре файла после проверки соответствующего SQL-запроса на локальной базе. Значения должны получаться из запроса, а не вводиться вручную. Затем скопируйте те же файлы в `../../submission/exports/`.

Все файлы должны быть валидным JSON в UTF-8. Числа записывайте без кавычек. Дополнительные поля для отображения допустимы, если обязательные поля ниже сохранены.

## funnel.json

В массиве `stages` должно быть пять объектов в таком порядке: регистрация, завершение онбординга, старт trial, просмотр paywall, успешная оплата.

```json
{
  "stages": [
    { "stage": "registration", "users": <число> },
    { "stage": "onboarding_completed", "users": <число> },
    { "stage": "trial_started", "users": <число> },
    { "stage": "paywall_viewed", "users": <число> },
    { "stage": "paid", "users": <число> }
  ]
}
```

## ab_onboarding.json

В массиве `variants` должно быть два объекта для вариантов `A` и `B` эксперимента `onboarding_v2`.

```json
{
  "variants": [
    {
      "variant": "A",
      "assigned_users": <число>,
      "completion_rate": <доля от 0 до 1>,
      "payment_rate": <доля от 0 до 1>
    },
    {
      "variant": "B",
      "assigned_users": <число>,
      "completion_rate": <доля от 0 до 1>,
      "payment_rate": <доля от 0 до 1>
    }
  ]
}
```

## economics.json

В массиве `channels` должно быть два объекта, по одному для каждого платного канала.

```json
{
  "channels": [
    {
      "channel_code": "search_ads",
      "cac_rub": <число>,
      "arpu_rub": <число>,
      "romi": <число>
    },
    {
      "channel_code": "social_ads",
      "cac_rub": <число>,
      "arpu_rub": <число>,
      "romi": <число>
    }
  ]
}
```

## revenue_weekly.json

В массиве `weeks` должна быть одна строка на каждую ISO-неделю, которую вернул запрос выручки. Формат недели: `ГГГГ-WNN`, например `2026-W09`.

```json
{
  "weeks": [
    { "week": "ГГГГ-WNN", "revenue_rub": <число> }
  ]
}
```

## Перед проверкой

1. Убедитесь, что JSON в `dashboard/exports/` и `submission/exports/` совпадает.
2. Не оставляйте в файлах шаблонные значения вида `<число>`.
3. Сохраните файлы и запустите `node check.mjs` из корневой папки.
