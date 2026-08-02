/**
 * Dreame Vacuum Card
 * Версия 1.0.0
 *
 * Самостоятельная Lovelace-карточка для робота-пылесоса Dreame.
 * Карточка не требует Mushroom, button-card, card-mod или других плагинов.
 *
 * Особенности реализации:
 * - Shadow DOM создаётся только один раз;
 * - при обновлении Home Assistant меняются только значения и классы;
 * - изображение карты не перезагружается без необходимости;
 * - дополнительные сущности могут быть заданы явно либо найдены автоматически;
 * - все списки выбора используют настоящие HTML <select>.
 */

const DREAME_CARD_TAG = "dreame-vacuum-card";
const DREAME_CARD_VERSION = "1.0.0";

const DREAME_DEFAULT_CONFIG = Object.freeze({
  name: "X60 Ultra Complete",
  room: "Гостиная",

  vacuum_entity: "vacuum.x60_ultra_complete",
  map_entity: "camera.x60_ultra_complete_map",

  // Дополнительные сущности необязательны. Если они не указаны,
  // карточка попробует найти их по имени робота и friendly_name.
  battery_entity: null,
  cleaned_area_entity: null,
  cleaning_time_entity: null,
  cleaning_mode_entity: null,
  suction_entity: null,
  water_volume_entity: null,
  charging_status_entity: null,
  clean_water_tank_entity: null,
  dirty_water_tank_entity: null,
  mop_pad_entity: null,

  show_map: true,
  show_settings: true,
  show_consumables: true,
});

const DREAME_STATUS_LABELS = Object.freeze({
  cleaning: "Уборка",
  paused: "Пауза",
  returning: "Возвращается на базу",
  docked: "У док-станции",
  idle: "Ожидание",
  stopped: "Остановлен",
  error: "Ошибка",
  unavailable: "Недоступен",
  unknown: "Неизвестно",
});

const DREAME_STATE_ACTIVE = new Set(["cleaning", "returning"]);

class DreameVacuumCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._config = null;
    this._hass = null;
    this._structureReady = false;
    this._resolved = Object.create(null);
    this._selectOptionKeys = new Map();
    this._lastMapUrl = "";
  }

  static getStubConfig() {
    return {
      type: `custom:${DREAME_CARD_TAG}`,
      ...DREAME_DEFAULT_CONFIG,
    };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Не задана конфигурация карточки");
    }

    const merged = {
      ...DREAME_DEFAULT_CONFIG,
      ...config,
    };

    if (!merged.vacuum_entity) {
      throw new Error("Не задан vacuum_entity");
    }

    this._config = merged;
    this._structureReady = false;
    this._resolved = Object.create(null);
    this._selectOptionKeys.clear();
    this._lastMapUrl = "";

    this._ensureStructure();
    this._updateState();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureStructure();
    this._resolveEntities();
    this._updateState();
  }

  getCardSize() {
    return 10;
  }

  /** Возвращает объект состояния Home Assistant. */
  _entity(entityId) {
    return entityId ? this._hass?.states?.[entityId] ?? null : null;
  }

  /** Возвращает state сущности либо запасное значение. */
  _state(entityId, fallback = "unknown") {
    return this._entity(entityId)?.state ?? fallback;
  }

  /** Префикс объекта, например x60_ultra_complete. */
  _devicePrefix() {
    return String(this._config?.vacuum_entity ?? "")
      .split(".")
      .slice(1)
      .join(".");
  }

  /** Нормализация строки для нечувствительного поиска сущностей. */
  _normalize(value) {
    return String(value ?? "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/g, " ")
      .trim();
  }

  /**
   * Ищет дополнительную сущность:
   * 1. берёт явно указанную в YAML;
   * 2. проверяет типичные entity_id;
   * 3. ищет по friendly_name среди сущностей того же устройства.
   */
  _discoverEntity(configKey, domain, suffixes, nameGroups = []) {
    const configured = this._config?.[configKey];
    if (configured && this._entity(configured)) return configured;

    const prefix = this._devicePrefix();

    for (const suffix of suffixes) {
      const candidate = `${domain}.${prefix}_${suffix}`;
      if (this._entity(candidate)) return candidate;
    }

    const requiredGroups = nameGroups.map((group) =>
      group.map((term) => this._normalize(term)),
    );

    for (const [entityId, entity] of Object.entries(this._hass?.states ?? {})) {
      if (!entityId.startsWith(`${domain}.${prefix}`)) continue;

      const searchable = this._normalize(
        `${entityId} ${entity.attributes?.friendly_name ?? ""}`,
      );

      const matched = requiredGroups.length === 0 || requiredGroups.every(
        (group) => group.some((term) => searchable.includes(term)),
      );

      if (matched) return entityId;
    }

    return configured || null;
  }

  /** Разрешает все необязательные сущности и сохраняет результат. */
  _resolveEntities() {
    if (!this._hass || !this._config) return;

    this._resolved = {
      battery: this._discoverEntity(
        "battery_entity",
        "sensor",
        ["battery_level", "battery_charge_level", "battery"],
        [["battery", "заряд"]],
      ),
      cleanedArea: this._discoverEntity(
        "cleaned_area_entity",
        "sensor",
        ["cleaned_area", "current_cleaning_area"],
        [["cleaned area", "площадь уборки"]],
      ),
      cleaningTime: this._discoverEntity(
        "cleaning_time_entity",
        "sensor",
        ["cleaning_time", "current_cleaning_time"],
        [["cleaning time", "время уборки"]],
      ),
      cleaningMode: this._discoverEntity(
        "cleaning_mode_entity",
        "select",
        ["cleaning_mode"],
        [["cleaning mode", "режим уборки"]],
      ),
      suction: this._discoverEntity(
        "suction_entity",
        "select",
        ["suction_level", "suction_power", "fan_speed"],
        [["suction", "всасывание", "мощность"]],
      ),
      waterVolume: this._discoverEntity(
        "water_volume_entity",
        "select",
        ["water_volume", "water_level", "wetness_level"],
        [["water", "вода", "увлажнение"]],
      ),
      chargingStatus: this._discoverEntity(
        "charging_status_entity",
        "sensor",
        ["charging_status", "charging_state"],
        [["charging", "зарядка"]],
      ),
      cleanWaterTank: this._discoverEntity(
        "clean_water_tank_entity",
        "sensor",
        ["clean_water_tank_status", "clean_water_tank"],
        [["clean water", "чистая вода"]],
      ),
      dirtyWaterTank: this._discoverEntity(
        "dirty_water_tank_entity",
        "sensor",
        ["dirty_water_tank_status", "dirty_water_tank"],
        [["dirty water", "грязная вода"]],
      ),
      mopPad: this._discoverEntity(
        "mop_pad_entity",
        "sensor",
        ["mop_pad", "mop_pad_status"],
        [["mop pad", "салфетка", "моп"]],
      ),
    };
  }

  async _callService(domain, service, data = {}) {
    try {
      await this._hass.callService(domain, service, data);
    } catch (error) {
      console.error(`[${DREAME_CARD_TAG}] Ошибка сервиса`, {
        domain,
        service,
        data,
        error,
      });
      this._notify("Не удалось выполнить команду");
    }
  }

  _notify(message) {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        bubbles: true,
        composed: true,
        detail: { message },
      }),
    );
  }

  _openMoreInfo(entityId) {
    if (!entityId) return;

    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  _vacuumService(service) {
    return this._callService("vacuum", service, {
      entity_id: this._config.vacuum_entity,
    });
  }

  _setSelect(entityId, option) {
    if (!entityId) return;

    return this._callService("select", "select_option", {
      entity_id: entityId,
      option,
    });
  }

  _setFanSpeed(speed) {
    return this._callService("vacuum", "set_fan_speed", {
      entity_id: this._config.vacuum_entity,
      fan_speed: speed,
    });
  }

  _ensureStructure() {
    if (this._structureReady || !this._config || !this._hass) return;

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>

      <ha-card class="vacuum-card">
        <section class="hero">
          <div class="hero__content">
            <button class="hero__title" id="vacuum-more" type="button">
              <span class="hero__icon">
                <ha-icon icon="mdi:robot-vacuum"></ha-icon>
              </span>
              <span class="hero__titles">
                <strong id="title"></strong>
                <small id="room"></small>
              </span>
            </button>

            <div class="hero__state-line">
              <span class="state-dot" id="state-dot"></span>
              <strong id="vacuum-state"></strong>
            </div>

            <div class="hero__battery">
              <ha-icon icon="mdi:battery"></ha-icon>
              <span id="hero-battery"></span>
            </div>
          </div>

          <button class="map-preview" id="map-more" type="button">
            <img id="map-image" alt="Карта уборки" />
            <span class="map-preview__overlay">
              <ha-icon icon="mdi:map-outline"></ha-icon>
              <small>Карта</small>
            </span>
            <span class="map-preview__empty" id="map-empty">
              <ha-icon icon="mdi:map-marker-off-outline"></ha-icon>
              <small>Карта недоступна</small>
            </span>
          </button>
        </section>

        <section class="action-grid">
          ${this._actionTemplate("start", "mdi:play", "Старт", "Начать уборку")}
          ${this._actionTemplate("pause", "mdi:pause", "Пауза", "Приостановить")}
          ${this._actionTemplate("home", "mdi:home-map-marker", "На базу", "Вернуться")}
          ${this._actionTemplate("locate", "mdi:map-marker-radius", "Найти", "Подать сигнал")}
        </section>

        <section class="stats-grid">
          ${this._statTemplate("battery", "mdi:battery", "Заряд")}
          ${this._statTemplate("area", "mdi:ruler-square", "Площадь")}
          ${this._statTemplate("time", "mdi:timer-outline", "Время")}
          ${this._statTemplate("status", "mdi:information-outline", "Состояние")}
        </section>

        <section class="settings-panel" id="settings-panel">
          ${this._selectRowTemplate(
            "mode-row",
            "mode-select",
            "mdi:creation-outline",
            "Режим уборки",
            "Основной алгоритм",
            "cyan",
          )}
          ${this._selectRowTemplate(
            "suction-row",
            "suction-select",
            "mdi:fan",
            "Мощность",
            "Всасывание",
            "orange",
          )}
          ${this._selectRowTemplate(
            "water-row",
            "water-select",
            "mdi:water-outline",
            "Подача воды",
            "Увлажнение салфеток",
            "blue",
          )}
        </section>

        <section class="consumables-panel" id="consumables-panel">
          ${this._infoRowTemplate("charging-row", "mdi:battery-charging", "Зарядка", "charging-value", "green")}
          ${this._infoRowTemplate("clean-water-row", "mdi:cup-water", "Чистая вода", "clean-water-value", "blue")}
          ${this._infoRowTemplate("dirty-water-row", "mdi:water-alert-outline", "Грязная вода", "dirty-water-value", "amber")}
          ${this._infoRowTemplate("mop-row", "mdi:hydro-power", "Салфетки", "mop-value", "purple")}
        </section>

        <section class="bottom-actions">
          <button id="stop" type="button">
            <ha-icon icon="mdi:stop-circle-outline"></ha-icon>
            <span>Остановить</span>
          </button>
          <button id="refresh-map" type="button">
            <ha-icon icon="mdi:refresh"></ha-icon>
            <span>Обновить карту</span>
          </button>
        </section>
      </ha-card>
    `;

    this._structureReady = true;
    this._applyStaticConfig();
    this._bindEvents();
  }

  _actionTemplate(id, icon, title, subtitle) {
    return `
      <button class="action-button" id="${id}" type="button">
        <ha-icon icon="${icon}"></ha-icon>
        <span><strong>${title}</strong><small>${subtitle}</small></span>
      </button>
    `;
  }

  _statTemplate(id, icon, label) {
    return `
      <button class="stat-card" id="stat-${id}" type="button">
        <ha-icon icon="${icon}"></ha-icon>
        <span><strong id="stat-${id}-value">—</strong><small>${label}</small></span>
      </button>
    `;
  }

  _selectRowTemplate(rowId, selectId, icon, title, subtitle, colorClass) {
    return `
      <div class="setting-row" id="${rowId}">
        <span class="setting-row__icon setting-row__icon--${colorClass}">
          <ha-icon icon="${icon}"></ha-icon>
        </span>
        <span class="setting-row__text">
          <strong>${title}</strong>
          <small>${subtitle}</small>
        </span>
        <label class="select-control">
          <select id="${selectId}" aria-label="${title}"></select>
          <ha-icon icon="mdi:chevron-down"></ha-icon>
        </label>
      </div>
    `;
  }

  _infoRowTemplate(rowId, icon, title, valueId, colorClass) {
    return `
      <button class="info-row" id="${rowId}" type="button">
        <span class="info-row__icon info-row__icon--${colorClass}">
          <ha-icon icon="${icon}"></ha-icon>
        </span>
        <span class="info-row__title">${title}</span>
        <strong id="${valueId}">—</strong>
      </button>
    `;
  }

  _applyStaticConfig() {
    this._setText("title", this._config.name);
    this._setText("room", this._config.room);

    const mapPreview = this.shadowRoot.getElementById("map-more");
    if (mapPreview) mapPreview.hidden = !this._config.show_map;

    const settings = this.shadowRoot.getElementById("settings-panel");
    if (settings) settings.hidden = !this._config.show_settings;

    const consumables = this.shadowRoot.getElementById("consumables-panel");
    if (consumables) consumables.hidden = !this._config.show_consumables;
  }

  _setText(id, value) {
    const element = this.shadowRoot.getElementById(id);
    const text = String(value ?? "—");
    if (element && element.textContent !== text) element.textContent = text;
  }

  _setHidden(id, hidden) {
    const element = this.shadowRoot.getElementById(id);
    if (element) element.hidden = Boolean(hidden);
  }

  _setDisabled(id, disabled) {
    const element = this.shadowRoot.getElementById(id);
    if (element) element.disabled = Boolean(disabled);
  }

  _formatEntityValue(entityId, fallback = "—") {
    const entity = this._entity(entityId);
    if (!entity || ["unknown", "unavailable", "none"].includes(entity.state)) {
      return fallback;
    }

    const unit = entity.attributes?.unit_of_measurement;
    return unit ? `${entity.state} ${unit}` : entity.state;
  }

  _batteryValue() {
    const vacuum = this._entity(this._config.vacuum_entity);
    const batteryEntity = this._entity(this._resolved.battery);
    const raw = batteryEntity?.state ?? vacuum?.attributes?.battery_level;
    const number = Number(raw);
    return Number.isFinite(number) ? Math.round(number) : null;
  }

  _mapUrl() {
    const map = this._entity(this._config.map_entity);
    return map?.attributes?.entity_picture ?? "";
  }

  _updateState() {
    if (!this._structureReady || !this._hass || !this._config) return;

    this._resolveEntities();

    const vacuum = this._entity(this._config.vacuum_entity);
    const state = vacuum?.state ?? "unavailable";
    const stateLabel = DREAME_STATUS_LABELS[state] ?? state;
    const battery = this._batteryValue();
    const unavailable = !vacuum || state === "unavailable";

    this._setText("vacuum-state", stateLabel);
    this._setText("hero-battery", battery === null ? "Заряд неизвестен" : `${battery}%`);
    this._setText("stat-battery-value", battery === null ? "—" : `${battery}%`);
    this._setText("stat-area-value", this._formatEntityValue(this._resolved.cleanedArea));
    this._setText("stat-time-value", this._formatEntityValue(this._resolved.cleaningTime));
    this._setText("stat-status-value", stateLabel);

    const dot = this.shadowRoot.getElementById("state-dot");
    if (dot) {
      dot.classList.toggle("is-active", DREAME_STATE_ACTIVE.has(state));
      dot.classList.toggle("is-error", state === "error" || unavailable);
    }

    this._setDisabled("start", unavailable || state === "cleaning" || state === "returning");
    this._setDisabled("pause", unavailable || state !== "cleaning");
    this._setDisabled("home", unavailable || state === "docked" || state === "returning");
    this._setDisabled("locate", unavailable);
    this._setDisabled("stop", unavailable || ["docked", "idle", "stopped"].includes(state));

    const startLabel = this.shadowRoot.querySelector("#start strong");
    const startSubtitle = this.shadowRoot.querySelector("#start small");
    if (startLabel) startLabel.textContent = state === "paused" ? "Продолжить" : "Старт";
    if (startSubtitle) startSubtitle.textContent = state === "paused" ? "Продолжить уборку" : "Начать уборку";

    this._updateMap();
    this._updateSettings(vacuum);
    this._updateConsumables();
  }

  _updateMap(force = false) {
    const image = this.shadowRoot.getElementById("map-image");
    const empty = this.shadowRoot.getElementById("map-empty");
    if (!image || !empty) return;

    let url = this._mapUrl();

    if (force && url) {
      const separator = url.includes("?") ? "&" : "?";
      url = `${url}${separator}_dreame_refresh=${Date.now()}`;
    }

    if (url) {
      if (force || url !== this._lastMapUrl) {
        image.src = url;
        this._lastMapUrl = url;
      }
      image.hidden = false;
      empty.hidden = true;
    } else {
      image.hidden = true;
      empty.hidden = false;
      this._lastMapUrl = "";
    }
  }

  _updateSettings(vacuum) {
    const cleaningModeEntity = this._entity(this._resolved.cleaningMode);
    const suctionEntity = this._entity(this._resolved.suction);
    const waterEntity = this._entity(this._resolved.waterVolume);

    this._updateSelectRow({
      rowId: "mode-row",
      selectId: "mode-select",
      entityId: this._resolved.cleaningMode,
      entity: cleaningModeEntity,
      serviceType: "select",
    });

    if (suctionEntity) {
      this._updateSelectRow({
        rowId: "suction-row",
        selectId: "suction-select",
        entityId: this._resolved.suction,
        entity: suctionEntity,
        serviceType: "select",
      });
    } else {
      const speeds = vacuum?.attributes?.fan_speed_list;
      const fanSpeed = vacuum?.attributes?.fan_speed;
      const hasFanSpeeds = Array.isArray(speeds) && speeds.length > 0;

      this._updateNativeSelect({
        rowId: "suction-row",
        selectId: "suction-select",
        entityId: this._config.vacuum_entity,
        value: fanSpeed,
        options: hasFanSpeeds ? speeds : [],
        serviceType: "fan_speed",
      });
    }

    this._updateSelectRow({
      rowId: "water-row",
      selectId: "water-select",
      entityId: this._resolved.waterVolume,
      entity: waterEntity,
      serviceType: "select",
    });

    const visibleRows = ["mode-row", "suction-row", "water-row"].some(
      (id) => !this.shadowRoot.getElementById(id)?.hidden,
    );

    this._setHidden(
      "settings-panel",
      !this._config.show_settings || !visibleRows,
    );
  }

  _updateSelectRow({ rowId, selectId, entityId, entity, serviceType }) {
    const options = Array.isArray(entity?.attributes?.options)
      ? entity.attributes.options
      : [];

    this._updateNativeSelect({
      rowId,
      selectId,
      entityId,
      value: entity?.state,
      options,
      serviceType,
    });
  }

  _updateNativeSelect({ rowId, selectId, entityId, value, options, serviceType }) {
    const row = this.shadowRoot.getElementById(rowId);
    const select = this.shadowRoot.getElementById(selectId);
    if (!row || !select) return;

    const usable = Boolean(entityId) && Array.isArray(options) && options.length > 0;
    row.hidden = !usable;
    if (!usable) return;

    const key = JSON.stringify(options);
    if (this._selectOptionKeys.get(selectId) !== key) {
      const fragment = document.createDocumentFragment();

      for (const optionValue of options) {
        const option = document.createElement("option");
        option.value = optionValue;
        option.textContent = this._humanize(optionValue);
        fragment.appendChild(option);
      }

      select.replaceChildren(fragment);
      this._selectOptionKeys.set(selectId, key);
    }

    select.dataset.entityId = entityId;
    select.dataset.serviceType = serviceType;

    if (this.shadowRoot.activeElement !== select && value != null) {
      select.value = value;
    }
  }

  _humanize(value) {
    const known = {
      off: "Выключено",
      on: "Включено",
      quiet: "Тихий",
      standard: "Стандартный",
      strong: "Сильный",
      turbo: "Турбо",
      max: "Максимальный",
      low: "Низкий",
      medium: "Средний",
      high: "Высокий",
      vacuuming: "Пылесос",
      mopping: "Влажная уборка",
      sweeping_and_mopping: "Пылесос и влажная уборка",
      customized_cleaning: "Настраиваемая уборка",
    };

    if (known[value] !== undefined) return known[value];

    return String(value ?? "")
      .replace(/[_-]+/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  _updateConsumables() {
    const rows = [
      ["charging-row", "charging-value", this._resolved.chargingStatus],
      ["clean-water-row", "clean-water-value", this._resolved.cleanWaterTank],
      ["dirty-water-row", "dirty-water-value", this._resolved.dirtyWaterTank],
      ["mop-row", "mop-value", this._resolved.mopPad],
    ];

    let visibleCount = 0;

    for (const [rowId, valueId, entityId] of rows) {
      const visible = Boolean(this._entity(entityId));
      this._setHidden(rowId, !visible);
      if (visible) {
        visibleCount += 1;
        this._setText(valueId, this._formatEntityValue(entityId));
      }
    }

    this._setHidden(
      "consumables-panel",
      !this._config.show_consumables || visibleCount === 0,
    );
  }

  _handleSelectChange(event) {
    const select = event.currentTarget;
    const entityId = select.dataset.entityId;
    const serviceType = select.dataset.serviceType;

    if (serviceType === "fan_speed") {
      this._setFanSpeed(select.value);
      return;
    }

    this._setSelect(entityId, select.value);
  }

  _bindEvents() {
    const root = this.shadowRoot;

    root.getElementById("vacuum-more")?.addEventListener(
      "click",
      () => this._openMoreInfo(this._config.vacuum_entity),
    );

    root.getElementById("map-more")?.addEventListener(
      "click",
      () => this._openMoreInfo(this._config.map_entity),
    );

    root.getElementById("start")?.addEventListener(
      "click",
      () => this._vacuumService("start"),
    );

    root.getElementById("pause")?.addEventListener(
      "click",
      () => this._vacuumService("pause"),
    );

    root.getElementById("home")?.addEventListener(
      "click",
      () => this._vacuumService("return_to_base"),
    );

    root.getElementById("locate")?.addEventListener(
      "click",
      () => this._vacuumService("locate"),
    );

    root.getElementById("stop")?.addEventListener(
      "click",
      () => this._vacuumService("stop"),
    );

    root.getElementById("refresh-map")?.addEventListener(
      "click",
      () => this._updateMap(true),
    );

    for (const id of ["mode-select", "suction-select", "water-select"]) {
      root.getElementById(id)?.addEventListener(
        "change",
        (event) => this._handleSelectChange(event),
      );
    }

    root.getElementById("stat-battery")?.addEventListener(
      "click",
      () => this._openMoreInfo(this._resolved.battery || this._config.vacuum_entity),
    );

    root.getElementById("stat-area")?.addEventListener(
      "click",
      () => this._openMoreInfo(this._resolved.cleanedArea),
    );

    root.getElementById("stat-time")?.addEventListener(
      "click",
      () => this._openMoreInfo(this._resolved.cleaningTime),
    );

    root.getElementById("stat-status")?.addEventListener(
      "click",
      () => this._openMoreInfo(this._config.vacuum_entity),
    );

    const infoBindings = [
      ["charging-row", "chargingStatus"],
      ["clean-water-row", "cleanWaterTank"],
      ["dirty-water-row", "dirtyWaterTank"],
      ["mop-row", "mopPad"],
    ];

    for (const [rowId, key] of infoBindings) {
      root.getElementById(rowId)?.addEventListener(
        "click",
        () => this._openMoreInfo(this._resolved[key]),
      );
    }
  }

  _styles() {
    return `
      :host {
        display: block;
        --dreame-cyan: #47d6d2;
        --dreame-blue: #4ca6ff;
        --dreame-orange: #ff9655;
        --dreame-red: #ff6b6b;
      }

      * { box-sizing: border-box; }
      button, select { font: inherit; }

      button {
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
      }

      [hidden] { display: none !important; }

      .vacuum-card {
        overflow: hidden;
        border-radius: 26px;
        border: 1px solid rgba(255,255,255,.09);
        color: #fff;
        background: linear-gradient(155deg,#191b1d,#0b0c0d);
        box-shadow: 0 14px 34px rgba(0,0,0,.34);
        font-family: var(--paper-font-body1_-_font-family);
      }

      .hero {
        min-height: 190px;
        padding: 22px;
        display: grid;
        grid-template-columns: minmax(0,1fr) minmax(155px,44%);
        align-items: stretch;
        gap: 18px;
        background:
          radial-gradient(circle at 75% 20%,rgba(71,214,210,.13),transparent 38%),
          linear-gradient(120deg,rgba(255,255,255,.035),transparent 55%);
      }

      .hero__content {
        min-width: 0;
        display: flex;
        flex-direction: column;
        justify-content: center;
      }

      .hero__title {
        min-width: 0;
        padding: 0;
        border: 0;
        display: flex;
        align-items: center;
        gap: 13px;
        color: inherit;
        background: transparent;
        text-align: left;
        cursor: pointer;
      }

      .hero__icon {
        width: 56px;
        height: 56px;
        flex: 0 0 56px;
        border-radius: 50%;
        display: grid;
        place-items: center;
        color: var(--dreame-cyan);
        background: rgba(71,214,210,.14);
        box-shadow: inset 0 0 0 1px rgba(71,214,210,.18);
      }

      .hero__icon ha-icon { width: 31px; height: 31px; }

      .hero__titles {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .hero__titles strong {
        overflow: hidden;
        font-size: 27px;
        line-height: 1.08;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hero__titles small {
        margin-top: 5px;
        color: rgba(255,255,255,.54);
        font-size: 14px;
      }

      .hero__state-line {
        margin-top: 30px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: rgba(255,255,255,.86);
      }

      .state-dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: #7b8288;
        box-shadow: 0 0 0 5px rgba(123,130,136,.10);
      }

      .state-dot.is-active {
        background: var(--dreame-cyan);
        box-shadow: 0 0 0 5px rgba(71,214,210,.13),0 0 16px rgba(71,214,210,.45);
      }

      .state-dot.is-error {
        background: var(--dreame-red);
        box-shadow: 0 0 0 5px rgba(255,107,107,.13);
      }

      .hero__state-line strong { font-size: 16px; }

      .hero__battery {
        margin-top: 11px;
        display: flex;
        align-items: center;
        gap: 7px;
        color: rgba(255,255,255,.54);
        font-size: 13px;
      }

      .hero__battery ha-icon {
        width: 18px;
        height: 18px;
        color: #7fe178;
      }

      .map-preview {
        position: relative;
        min-width: 0;
        min-height: 146px;
        padding: 0;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.10);
        border-radius: 20px;
        color: #fff;
        background:
          linear-gradient(145deg,rgba(255,255,255,.08),rgba(255,255,255,.025));
        cursor: pointer;
      }

      .map-preview img {
        width: 100%;
        height: 100%;
        min-height: 146px;
        display: block;
        object-fit: cover;
        filter: saturate(.88) contrast(1.04) brightness(.82);
      }

      .map-preview::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg,transparent 45%,rgba(5,7,8,.72));
        pointer-events: none;
      }

      .map-preview__overlay {
        position: absolute;
        z-index: 2;
        right: 12px;
        bottom: 10px;
        display: flex;
        align-items: center;
        gap: 5px;
        color: rgba(255,255,255,.88);
      }

      .map-preview__overlay ha-icon { width: 18px; height: 18px; }
      .map-preview__overlay small { font-size: 11px; }

      .map-preview__empty {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: rgba(255,255,255,.42);
      }

      .map-preview__empty ha-icon { width: 30px; height: 30px; }
      .map-preview__empty small { font-size: 11px; }

      .action-grid {
        padding: 0 18px 13px;
        display: grid;
        grid-template-columns: repeat(4,minmax(0,1fr));
        gap: 9px;
      }

      .action-button {
        min-width: 0;
        height: 90px;
        padding: 10px 7px;
        border: 1px solid rgba(255,255,255,.085);
        border-radius: 18px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 7px;
        color: rgba(255,255,255,.88);
        background: rgba(255,255,255,.045);
        cursor: pointer;
      }

      .action-button ha-icon {
        width: 27px;
        height: 27px;
        color: var(--dreame-cyan);
      }

      .action-button > span {
        min-width: 0;
        display: flex;
        flex-direction: column;
        text-align: center;
      }

      .action-button strong,
      .action-button small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .action-button strong { font-size: 13px; }
      .action-button small {
        margin-top: 3px;
        color: rgba(255,255,255,.45);
        font-size: 9px;
      }

      .action-button:active { transform: scale(.97); }
      .action-button:disabled { opacity: .30; cursor: default; transform: none; }
      #pause ha-icon { color: #ffd166; }
      #home ha-icon { color: var(--dreame-blue); }
      #locate ha-icon { color: #b08cff; }

      .stats-grid {
        padding: 0 18px 14px;
        display: grid;
        grid-template-columns: repeat(4,minmax(0,1fr));
        gap: 8px;
      }

      .stat-card {
        min-width: 0;
        height: 66px;
        padding: 8px;
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        color: #fff;
        background: rgba(255,255,255,.035);
        cursor: pointer;
      }

      .stat-card ha-icon {
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
        color: var(--dreame-cyan);
      }

      .stat-card:nth-child(2) ha-icon { color: var(--dreame-orange); }
      .stat-card:nth-child(3) ha-icon { color: #ffd166; }
      .stat-card:nth-child(4) ha-icon { color: var(--dreame-blue); }

      .stat-card > span {
        min-width: 0;
        display: flex;
        flex-direction: column;
        text-align: left;
      }

      .stat-card strong,
      .stat-card small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .stat-card strong { font-size: 13px; }
      .stat-card small {
        margin-top: 3px;
        color: rgba(255,255,255,.45);
        font-size: 9px;
      }

      .settings-panel,
      .consumables-panel {
        margin: 0 18px 14px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.07);
        border-radius: 21px;
        background: rgba(255,255,255,.035);
      }

      .setting-row,
      .info-row {
        width: 100%;
        min-height: 72px;
        padding: 11px 14px;
        border: 0;
        border-bottom: 1px solid rgba(255,255,255,.065);
        display: grid;
        grid-template-columns: 44px minmax(0,1fr) auto;
        align-items: center;
        gap: 12px;
        color: #fff;
        background: transparent;
        text-align: left;
      }

      .setting-row:last-child,
      .info-row:last-child { border-bottom: 0; }

      .setting-row__icon,
      .info-row__icon {
        width: 44px;
        height: 44px;
        border-radius: 50%;
        display: grid;
        place-items: center;
      }

      .setting-row__icon ha-icon,
      .info-row__icon ha-icon { width: 23px; height: 23px; }

      .setting-row__icon--cyan {
        color: var(--dreame-cyan);
        background: rgba(71,214,210,.13);
      }
      .setting-row__icon--orange {
        color: var(--dreame-orange);
        background: rgba(255,150,85,.13);
      }
      .setting-row__icon--blue {
        color: var(--dreame-blue);
        background: rgba(76,166,255,.13);
      }

      .info-row__icon--green {
        color: #7fe178;
        background: rgba(127,225,120,.13);
      }
      .info-row__icon--blue {
        color: var(--dreame-blue);
        background: rgba(76,166,255,.13);
      }
      .info-row__icon--amber {
        color: #ffd166;
        background: rgba(255,209,102,.13);
      }
      .info-row__icon--purple {
        color: #b08cff;
        background: rgba(176,140,255,.13);
      }

      .setting-row__text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .setting-row__text strong { font-size: 15px; }
      .setting-row__text small {
        margin-top: 4px;
        color: rgba(255,255,255,.45);
        font-size: 11px;
      }

      .select-control {
        position: relative;
        display: block;
      }

      .select-control select {
        min-width: 132px;
        max-width: 175px;
        height: 45px;
        padding: 0 38px 0 12px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 14px;
        appearance: none;
        color: #eee;
        background: #292b2d;
        cursor: pointer;
        text-overflow: ellipsis;
      }

      .select-control > ha-icon {
        position: absolute;
        top: 50%;
        right: 10px;
        width: 19px;
        height: 19px;
        color: rgba(255,255,255,.50);
        pointer-events: none;
        transform: translateY(-50%);
      }

      .info-row { cursor: pointer; }
      .info-row__title { font-size: 14px; }
      .info-row > strong {
        max-width: 160px;
        overflow: hidden;
        color: rgba(255,255,255,.72);
        font-size: 12px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .bottom-actions {
        padding: 0 18px 18px;
        display: grid;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 9px;
      }

      .bottom-actions button {
        height: 48px;
        border: 1px solid rgba(255,255,255,.075);
        border-radius: 15px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: rgba(255,255,255,.70);
        background: rgba(255,255,255,.035);
        cursor: pointer;
      }

      .bottom-actions ha-icon { width: 20px; height: 20px; }
      #stop ha-icon { color: var(--dreame-red); }
      #refresh-map ha-icon { color: var(--dreame-cyan); }
      .bottom-actions button:disabled { opacity: .30; cursor: default; }

      button:focus-visible,
      select:focus-visible {
        outline: 2px solid rgba(71,214,210,.90);
        outline-offset: 2px;
      }

      @media (hover: hover) {
        .action-button:hover,
        .stat-card:hover,
        .info-row:hover,
        .bottom-actions button:hover,
        .map-preview:hover { filter: brightness(1.10); }
      }

      @media (max-width: 480px) {
        .hero {
          min-height: 154px;
          padding: 15px;
          grid-template-columns: minmax(0,1fr) minmax(128px,44%);
          gap: 10px;
        }

        .hero__icon {
          width: 44px;
          height: 44px;
          flex-basis: 44px;
        }

        .hero__icon ha-icon { width: 26px; height: 26px; }
        .hero__title { gap: 9px; }
        .hero__titles strong { font-size: 19px; }
        .hero__titles small { font-size: 11px; }
        .hero__state-line { margin-top: 21px; gap: 6px; }
        .hero__state-line strong { font-size: 12px; }
        .hero__battery { margin-top: 8px; font-size: 10px; }

        .map-preview,
        .map-preview img { min-height: 124px; }

        .action-grid {
          padding: 0 11px 10px;
          gap: 6px;
        }

        .action-button {
          height: 72px;
          padding: 6px 3px;
          gap: 4px;
        }

        .action-button ha-icon { width: 23px; height: 23px; }
        .action-button strong { font-size: 10px; }
        .action-button small { font-size: 7px; }

        .stats-grid {
          padding: 0 11px 10px;
          gap: 5px;
        }

        .stat-card {
          height: 51px;
          padding: 5px 3px;
          gap: 3px;
        }

        .stat-card ha-icon {
          width: 16px;
          height: 16px;
          flex-basis: 16px;
        }

        .stat-card strong { font-size: 9px; }
        .stat-card small { font-size: 7px; }

        .settings-panel,
        .consumables-panel { margin: 0 11px 10px; }

        .setting-row,
        .info-row {
          min-height: 62px;
          padding: 8px 9px;
          grid-template-columns: 38px minmax(0,1fr) auto;
          gap: 8px;
        }

        .setting-row__icon,
        .info-row__icon {
          width: 38px;
          height: 38px;
        }

        .setting-row__icon ha-icon,
        .info-row__icon ha-icon { width: 20px; height: 20px; }

        .setting-row__text strong,
        .info-row__title { font-size: 12px; }
        .setting-row__text small { font-size: 8px; }

        .select-control select {
          min-width: 96px;
          max-width: 112px;
          height: 38px;
          padding: 0 30px 0 7px;
          font-size: 10px;
        }

        .select-control > ha-icon {
          right: 6px;
          width: 17px;
          height: 17px;
        }

        .info-row > strong {
          max-width: 100px;
          font-size: 10px;
        }

        .bottom-actions {
          padding: 0 11px 12px;
          gap: 6px;
        }

        .bottom-actions button {
          height: 43px;
          font-size: 11px;
        }
      }

      @media (max-width: 365px) {
        .hero {
          grid-template-columns: minmax(0,1fr) 122px;
        }

        .hero__titles strong { font-size: 17px; }
        .hero__icon { display: none; }
        .select-control select { max-width: 98px; }
      }
    `;
  }
}

if (!customElements.get(DREAME_CARD_TAG)) {
  customElements.define(DREAME_CARD_TAG, DreameVacuumCard);
}

window.customCards = window.customCards || [];

if (!window.customCards.some((card) => card.type === DREAME_CARD_TAG)) {
  window.customCards.push({
    type: DREAME_CARD_TAG,
    name: "Dreame Vacuum Card",
    description: "Карточка управления роботом-пылесосом Dreame",
    preview: false,
  });
}

console.info(
  `%c DREAME-VACUUM-CARD %c v${DREAME_CARD_VERSION} `,
  "color:white;background:#23a9a5;font-weight:700;",
  "color:#47d6d2;background:#151718;",
);