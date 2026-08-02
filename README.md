# Heatstick Heater Card

Отдельная Lovelace-карточка Home Assistant для управления обогревателем Heatstick. Карточка не требует Mushroom, button-card, card-mod или layout-card.

## Файлы проекта

- `heatstick-heater-card.js` — компактная версия для установки в Home Assistant.
- `src/heatstick-heater-card.js` — полный несжатый исходник с русскими комментариями и читаемым форматированием.
- `examples/card.yaml` — пример конфигурации карточки.
- `hacs.json` — описание репозитория для HACS.

## Установка вручную

1. Скопируйте `heatstick-heater-card.js` в `/config/www/heatstick-heater-card.js`.
2. В Home Assistant откройте **Настройки → Панели → Ресурсы**.
3. Добавьте `/local/heatstick-heater-card.js` как **JavaScript module**.
4. Полностью обновите страницу с очисткой кэша.
5. Добавьте карточку из `examples/card.yaml`.

Для разработки можно использовать `src/heatstick-heater-card.js` напрямую: скопируйте его в `/config/www/heatstick-heater-card.js` либо зарегистрируйте отдельным ресурсом с другим именем. Нельзя одновременно подключать компактную и исходную версии, поскольку обе регистрируют один и тот же Web Component.

Изображение шапки должно находиться в `/config/www/heater.png`, тогда в YAML используется путь `/local/heater.png`.

## Возможности

- включение, выключение и блокировка;
- изменение целевой температуры с учётом `min`, `max` и `step`;
- настоящие выпадающие списки режима, мощности и дисплея;
- переключатель подсветки;
- адаптивный дизайн для телефона и компьютера;
- открытие стандартного окна More Info по нажатию на показатели.

## Используемые сущности

- `select.heatstick_839944_status`
- `sensor.heatstick_839944_current_temperature`
- `number.heatstick_839944_target_temperature`
- `select.heatstick_839944_mode`
- `select.heatstick_839944_power`
- `select.heatstick_839944_display`
- `switch.heatstick_839944_led`
