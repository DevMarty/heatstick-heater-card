# Dreame Vacuum Card

Самостоятельная Lovelace-карточка для **Dreame X60 Ultra Complete**. Карта отображается компактно справа в шапке, как изображение в карточке обогревателя.

Карточка не требует Mushroom, button-card, card-mod или layout-card.

## Возможности

- живая компактная карта;
- запуск и продолжение уборки;
- пауза, остановка и возврат на базу;
- поиск робота;
- заряд, площадь, время и текущее состояние;
- режим уборки, мощность всасывания и подача воды;
- состояние зарядки, баков и салфеток;
- автоматический поиск дополнительных сущностей;
- статичный Shadow DOM без прыгающих кнопок и селектов.

## Установка

1. Скопируйте `dreame-vacuum-card.js` в:

   ```text
   /config/www/dreame-vacuum-card.js
   ```

2. В Home Assistant откройте **Настройки → Панели → Ресурсы**.

3. Добавьте ресурс:

   ```text
   /local/dreame-vacuum-card.js?v=1.0.0
   ```

   Тип: **JavaScript module**.

4. Выполните полное обновление страницы с очисткой кэша.

5. Добавьте YAML из `examples/card.yaml`.

## Минимальная конфигурация

```yaml
type: custom:dreame-vacuum-card
name: X60 Ultra Complete
room: Гостиная
vacuum_entity: vacuum.x60_ultra_complete
map_entity: camera.x60_ultra_complete_map
```

## Автопоиск сущностей

Для дополнительных показателей карточка сначала проверяет entity_id из YAML, затем типичные имена с префиксом `x60_ultra_complete`, после чего ищет сущности по `friendly_name`.

Если какая-либо строка отсутствует или показывает не ту сущность, задайте её явно:

```yaml
battery_entity: sensor.x60_ultra_complete_battery_level
cleaned_area_entity: sensor.x60_ultra_complete_cleaned_area
cleaning_time_entity: sensor.x60_ultra_complete_cleaning_time
cleaning_mode_entity: select.x60_ultra_complete_cleaning_mode
suction_entity: select.x60_ultra_complete_suction_level
water_volume_entity: select.x60_ultra_complete_water_volume
charging_status_entity: sensor.x60_ultra_complete_charging_status
clean_water_tank_entity: sensor.x60_ultra_complete_clean_water_tank_status
dirty_water_tank_entity: sensor.x60_ultra_complete_dirty_water_tank_status
mop_pad_entity: sensor.x60_ultra_complete_mop_pad
```

Необнаруженные необязательные строки автоматически скрываются.

## Примечание о карте

Карточка берёт подписанный адрес изображения из атрибута `entity_picture` сущности камеры. Токен вручную указывать не нужно.
