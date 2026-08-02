/**
 * Heatstick Heater Card
 * ---------------------
 * Кастомная Lovelace-карточка Home Assistant для обогревателя Heatstick.
 *
 * Файл специально оставлен несжатым и подробно прокомментирован.
 * Карточка не зависит от Mushroom, button-card, card-mod или layout-card.
 *
 * @version 1.0.0-source
 * @license MIT
 */

const CARD_VERSION = "1.0.0-source";
const CARD_TAG = "heatstick-heater-card";

/**
 * Значения по умолчанию.
 * Их можно переопределить в YAML карточки.
 */
const DEFAULT_CONFIG = Object.freeze({
  name: "Обогреватель",
  room: "Гостиная",
  image: "/local/heater.png",
  temperature_decimals: 0,

  status_entity: "select.heatstick_839944_status",
  current_temperature_entity:
    "sensor.heatstick_839944_current_temperature",
  target_temperature_entity:
    "number.heatstick_839944_target_temperature",
  mode_entity: "select.heatstick_839944_mode",
  power_entity: "select.heatstick_839944_power",
  display_entity: "select.heatstick_839944_display",
  led_entity: "switch.heatstick_839944_led",
});

/**
 * Параметры сущностей, без которых карточка не сможет работать.
 */
const REQUIRED_ENTITY_KEYS = Object.freeze([
  "status_entity",
  "current_temperature_entity",
  "target_temperature_entity",
  "mode_entity",
  "power_entity",
  "display_entity",
  "led_entity",
]);

/**
 * Русские подписи для значений select.
 */
const STATUS_LABELS = Object.freeze({
  on: "Включён",
  off: "Выключен",
  block: "Заблокирован",
  unknown: "Недоступен",
  unavailable: "Недоступен",
});

const MODE_LABELS = Object.freeze({
  comfort: "Комфорт",
  night: "Ночной",
  nofrost: "Антизамерзание",
});

const POWER_LABELS = Object.freeze({
  lev1: "Уровень 1",
  lev2: "Уровень 2",
  lev3: "Уровень 3",
  lev4: "Уровень 4",
  lev5: "Уровень 5",
  auto: "Авто",
});

const DISPLAY_LABELS = Object.freeze({
  on: "Включён",
  off: "Выключен",
});

/**
 * Основной Web Component карточки.
 */
class HeatstickHeaterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = null;
    this._hass = null;
    this._lastRenderKey = "";
  }

  /**
   * Конфигурация для визуального редактора Home Assistant.
   */
  static getStubConfig() {
    return {
      type: `custom:${CARD_TAG}`,
      ...DEFAULT_CONFIG,
    };
  }

  /**
   * Home Assistant вызывает setConfig при создании карточки
   * и после изменения YAML.
   */
  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Не задана конфигурация карточки");
    }

    const mergedConfig = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    for (const key of REQUIRED_ENTITY_KEYS) {
      if (!mergedConfig[key]) {
        throw new Error(`Не задан обязательный параметр: ${key}`);
      }
    }

    this._config = mergedConfig;
    this._lastRenderKey = "";
    this._render();
  }

  /** Home Assistant передаёт hass при каждом изменении состояния. */
  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 10;
  }

  /** Возвращает объект состояния сущности. */
  _entity(entityId) {
    return this._hass?.states?.[entityId] ?? null;
  }

  /** Возвращает state сущности или запасное значение. */
  _state(entityId, fallback = "unknown") {
    return this._entity(entityId)?.state ?? fallback;
  }

  /** Экранирует данные перед вставкой в HTML. */
  _escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => {
      const replacements = {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      };
      return replacements[character];
    });
  }

  /** Форматирует температуру. */
  _formatTemperature(rawValue) {
    const number = Number(rawValue);
    if (!Number.isFinite(number)) return "—";

    const decimals = Number(this._config?.temperature_decimals ?? 0);
    const safeDecimals = Number.isInteger(decimals)
      ? Math.min(2, Math.max(0, decimals))
      : 0;

    return number.toFixed(safeDecimals);
  }

  _label(dictionary, value) {
    return dictionary[value] ?? value;
  }

  /** Обёртка над hass.callService с обработкой ошибки. */
  async _callService(domain, service, data) {
    try {
      await this._hass.callService(domain, service, data);
    } catch (error) {
      console.error(`[${CARD_TAG}] Ошибка вызова сервиса`, error);
      this._showNotification("Не удалось выполнить команду");
    }
  }

  _showNotification(message) {
    this.dispatchEvent(
      new CustomEvent("hass-notification", {
        bubbles: true,
        composed: true,
        detail: { message },
      }),
    );
  }

  /** Открывает стандартное окно More Info. */
  _openMoreInfo(entityId) {
    this.dispatchEvent(
      new CustomEvent("hass-more-info", {
        bubbles: true,
        composed: true,
        detail: { entityId },
      }),
    );
  }

  _setSelect(entityId, option) {
    return this._callService("select", "select_option", {
      entity_id: entityId,
      option,
    });
  }

  _toggleSwitch(entityId) {
    return this._callService("switch", "toggle", {
      entity_id: entityId,
    });
  }

  /**
   * Изменяет целевую температуру.
   * min, max и step берутся из атрибутов number-сущности.
   */
  _changeTargetTemperature(direction) {
    const entityId = this._config.target_temperature_entity;
    const entity = this._entity(entityId);

    const current = Number(entity?.state);
    const minimum = Number(entity?.attributes?.min ?? 0);
    const maximum = Number(entity?.attributes?.max ?? 30);
    const step = Number(entity?.attributes?.step ?? 1);

    if (!Number.isFinite(current)) {
      this._showNotification("Целевая температура недоступна");
      return;
    }

    const nextValue = Math.min(
      maximum,
      Math.max(minimum, current + direction * step),
    );

    this._callService("number", "set_value", {
      entity_id: entityId,
      value: nextValue,
    });
  }

  /** Формирует option для нативного HTML-select. */
  _renderSelectOptions(entityId, currentValue, dictionary) {
    const options = this._entity(entityId)?.attributes?.options;
    const values = Array.isArray(options) && options.length
      ? options
      : [currentValue];

    return values
      .map((value) => {
        const selected = value === currentValue ? " selected" : "";
        const text = this._label(dictionary, value);
        return `<option value="${this._escapeHtml(value)}"${selected}>${this._escapeHtml(text)}</option>`;
      })
      .join("");
  }

  /**
   * Ключ состояний, влияющих на карточку.
   * Нужен для пропуска лишних перерисовок.
   */
  _getRenderKey() {
    if (!this._config || !this._hass) return "";

    const c = this._config;

    return JSON.stringify({
      config: c,
      status: this._state(c.status_entity),
      current: this._state(c.current_temperature_entity),
      target: this._state(c.target_temperature_entity),
      mode: this._state(c.mode_entity),
      power: this._state(c.power_entity),
      display: this._state(c.display_entity),
      led: this._state(c.led_entity),
      targetAttributes: this._entity(c.target_temperature_entity)?.attributes,
      modeOptions: this._entity(c.mode_entity)?.attributes?.options,
      powerOptions: this._entity(c.power_entity)?.attributes?.options,
      displayOptions: this._entity(c.display_entity)?.attributes?.options,
    });
  }

  /** Главная функция рендера. */
  _render() {
    if (!this._config || !this._hass) return;

    const renderKey = this._getRenderKey();
    if (renderKey === this._lastRenderKey) return;
    this._lastRenderKey = renderKey;

    const c = this._config;
    const status = this._state(c.status_entity);
    const currentTemperature = this._formatTemperature(
      this._state(c.current_temperature_entity),
    );
    const targetTemperature = this._formatTemperature(
      this._state(c.target_temperature_entity),
    );
    const mode = this._state(c.mode_entity);
    const power = this._state(c.power_entity);
    const display = this._state(c.display_entity);
    const led = this._state(c.led_entity);

    const statusText = this._label(STATUS_LABELS, status);
    const modeText = this._label(MODE_LABELS, mode);
    const powerText = this._label(POWER_LABELS, power);
    const displayText = this._label(DISPLAY_LABELS, display);

    const powerLevel = power === "auto"
      ? 5
      : Number(String(power).replace("lev", "")) || 0;

    const powerBars = [1, 2, 3, 4, 5]
      .map((level) => {
        const activeClass = level <= powerLevel ? " is-active" : "";
        return `<i class="power-bar${activeClass}"></i>`;
      })
      .join("");

    const modeOptions = this._renderSelectOptions(
      c.mode_entity,
      mode,
      MODE_LABELS,
    );
    const powerOptions = this._renderSelectOptions(
      c.power_entity,
      power,
      POWER_LABELS,
    );
    const displayOptions = this._renderSelectOptions(
      c.display_entity,
      display,
      DISPLAY_LABELS,
    );

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>

      <ha-card class="heater-card">
        <!-- Шапка с названием, комнатой и изображением -->
        <section class="hero" id="hero">
          <div class="hero__content">
            <button class="hero__title-button" id="header-button" type="button">
              <span class="hero__icon">
                <ha-icon icon="mdi:radiator"></ha-icon>
              </span>
              <span class="hero__titles">
                <strong>${this._escapeHtml(c.name)}</strong>
                <small>${this._escapeHtml(c.room)}</small>
              </span>
            </button>
            <div class="hero__status">
              ${this._escapeHtml(statusText)} · ${currentTemperature} °C
            </div>
          </div>
        </section>

        <!-- Текущая и целевая температура -->
        <section class="temperature-grid">
          <button
            class="temperature-card temperature-card--current"
            id="current-temperature-button"
            type="button"
          >
            <small>Текущая температура</small>
            <span class="temperature-value">
              <ha-icon icon="mdi:thermometer"></ha-icon>
              <strong>${currentTemperature}</strong>
              <em>°C</em>
            </span>
          </button>

          <div class="temperature-card temperature-card--target">
            <small class="temperature-card__accent">Целевая температура</small>
            <div class="target-control">
              <button
                class="target-control__button"
                id="target-minus"
                type="button"
                aria-label="Уменьшить целевую температуру"
              >−</button>

              <button
                class="target-control__value"
                id="target-temperature-button"
                type="button"
              >
                <strong>${targetTemperature}</strong>
                <em>°C</em>
              </button>

              <button
                class="target-control__button"
                id="target-plus"
                type="button"
                aria-label="Увеличить целевую температуру"
              >+</button>
            </div>
          </div>
        </section>

        <!-- Три основные команды -->
        <section class="action-grid">
          <button
            class="action-button action-button--on ${status === "on" ? "is-active" : ""}"
            id="status-on"
            type="button"
          >
            <ha-icon icon="mdi:power"></ha-icon>
            <span><strong>Включить</strong><small>Обогрев</small></span>
          </button>

          <button
            class="action-button action-button--off ${status === "off" ? "is-active" : ""}"
            id="status-off"
            type="button"
          >
            <ha-icon icon="mdi:stop-circle-outline"></ha-icon>
            <span><strong>Выключить</strong><small>Остановить</small></span>
          </button>

          <button
            class="action-button action-button--block ${status === "block" ? "is-active" : ""}"
            id="status-block"
            type="button"
          >
            <ha-icon icon="mdi:lock-outline"></ha-icon>
            <span><strong>Блокировка</strong><small>Защита</small></span>
          </button>
        </section>

        <!-- Настройки с настоящими HTML-select -->
        <section class="settings-panel">
          <div class="setting-row">
            <span class="setting-row__icon setting-row__icon--orange">
              <ha-icon icon="mdi:home-thermometer"></ha-icon>
            </span>
            <span class="setting-row__text">
              <strong>Режим работы</strong>
              <small>${this._escapeHtml(modeText)}</small>
            </span>
            <label class="select-control">
              <select id="mode-select" aria-label="Режим работы">
                ${modeOptions}
              </select>
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </label>
          </div>

          <div class="setting-row">
            <span class="setting-row__icon setting-row__icon--amber">
              <ha-icon icon="mdi:lightning-bolt"></ha-icon>
            </span>
            <span class="setting-row__text">
              <strong>Мощность</strong>
              <small>${this._escapeHtml(powerText)}</small>
            </span>
            <span class="power-control">
              <label class="select-control">
                <select id="power-select" aria-label="Мощность">
                  ${powerOptions}
                </select>
                <ha-icon icon="mdi:chevron-down"></ha-icon>
              </label>
              <span class="power-bars" aria-hidden="true">${powerBars}</span>
            </span>
          </div>

          <div class="setting-row">
            <span class="setting-row__icon setting-row__icon--blue">
              <ha-icon icon="mdi:monitor"></ha-icon>
            </span>
            <span class="setting-row__text">
              <strong>Дисплей</strong>
              <small>${this._escapeHtml(displayText)}</small>
            </span>
            <label class="select-control">
              <select id="display-select" aria-label="Дисплей">
                ${displayOptions}
              </select>
              <ha-icon icon="mdi:chevron-down"></ha-icon>
            </label>
          </div>

          <div class="setting-row">
            <span class="setting-row__icon setting-row__icon--purple">
              <ha-icon icon="mdi:lightbulb-outline"></ha-icon>
            </span>
            <span class="setting-row__text">
              <strong>Подсветка</strong>
              <small>${led === "on" ? "Включена" : "Выключена"}</small>
            </span>
            <button
              class="toggle-control ${led === "on" ? "is-active" : ""}"
              id="led-toggle"
              type="button"
              role="switch"
              aria-checked="${led === "on"}"
              aria-label="Переключить подсветку"
            ><i></i></button>
          </div>
        </section>

        <!-- Нижняя сводка -->
        <section class="summary-grid">
          <button class="summary-chip" id="summary-current" type="button">
            <ha-icon icon="mdi:thermometer"></ha-icon>
            <span><strong>${currentTemperature} °C</strong><small>Текущая</small></span>
          </button>

          <button class="summary-chip summary-chip--blue" id="summary-target" type="button">
            <ha-icon icon="mdi:target"></ha-icon>
            <span><strong>${targetTemperature} °C</strong><small>Цель</small></span>
          </button>

          <button class="summary-chip summary-chip--amber" id="summary-power" type="button">
            <ha-icon icon="mdi:lightning-bolt"></ha-icon>
            <span><strong>${this._escapeHtml(powerText)}</strong><small>Мощность</small></span>
          </button>

          <button class="summary-chip" id="summary-mode" type="button">
            <ha-icon icon="mdi:home-thermometer"></ha-icon>
            <span><strong>${this._escapeHtml(modeText)}</strong><small>Режим</small></span>
          </button>
        </section>
      </ha-card>
    `;

    /* Фоновое изображение передаём через CSS custom property. */
    const hero = this.shadowRoot.getElementById("hero");
    const safeImage = String(c.image ?? DEFAULT_CONFIG.image).replace(/"/g, "\\\"");
    hero?.style.setProperty("--heater-image", `url("${safeImage}")`);

    this._bindEvents();
  }

  /** Подключает обработчики после перерисовки Shadow DOM. */
  _bindEvents() {
    const c = this._config;
    const root = this.shadowRoot;

    root.getElementById("header-button")?.addEventListener("click", () => {
      this._openMoreInfo(c.status_entity);
    });

    root.getElementById("current-temperature-button")?.addEventListener("click", () => {
      this._openMoreInfo(c.current_temperature_entity);
    });

    root.getElementById("target-temperature-button")?.addEventListener("click", () => {
      this._openMoreInfo(c.target_temperature_entity);
    });

    root.getElementById("target-minus")?.addEventListener("click", () => {
      this._changeTargetTemperature(-1);
    });

    root.getElementById("target-plus")?.addEventListener("click", () => {
      this._changeTargetTemperature(1);
    });

    root.getElementById("status-on")?.addEventListener("click", () => {
      this._setSelect(c.status_entity, "on");
    });

    root.getElementById("status-off")?.addEventListener("click", () => {
      this._setSelect(c.status_entity, "off");
    });

    root.getElementById("status-block")?.addEventListener("click", () => {
      this._setSelect(c.status_entity, "block");
    });

    root.getElementById("mode-select")?.addEventListener("change", (event) => {
      this._setSelect(c.mode_entity, event.target.value);
    });

    root.getElementById("power-select")?.addEventListener("change", (event) => {
      this._setSelect(c.power_entity, event.target.value);
    });

    root.getElementById("display-select")?.addEventListener("change", (event) => {
      this._setSelect(c.display_entity, event.target.value);
    });

    root.getElementById("led-toggle")?.addEventListener("click", () => {
      this._toggleSwitch(c.led_entity);
    });

    root.getElementById("summary-current")?.addEventListener("click", () => {
      this._openMoreInfo(c.current_temperature_entity);
    });

    root.getElementById("summary-target")?.addEventListener("click", () => {
      this._openMoreInfo(c.target_temperature_entity);
    });

    root.getElementById("summary-power")?.addEventListener("click", () => {
      this._openMoreInfo(c.power_entity);
    });

    root.getElementById("summary-mode")?.addEventListener("click", () => {
      this._openMoreInfo(c.mode_entity);
    });
  }

  /** CSS карточки и адаптив для телефона. */
  _styles() {
    return `
      :host {
        display: block;
        --heater-orange: #ff7a2f;
        --heater-blue: #63c3ef;
        --heater-red: #ff736a;
        --heater-amber: #ffc107;
      }

      * { box-sizing: border-box; }
      button, select { font: inherit; }
      button { -webkit-tap-highlight-color: transparent; }

      .heater-card {
        overflow: hidden;
        border-radius: 26px;
        border: 1px solid rgba(255,255,255,.09);
        background: linear-gradient(160deg,#1b1b1b,#0d0d0d);
        color: #fff;
        box-shadow: 0 14px 34px rgba(0,0,0,.34);
        font-family: var(--paper-font-body1_-_font-family);
      }

      .hero {
        height: 190px;
        padding: 24px;
        display: flex;
        align-items: flex-start;
        background:
          linear-gradient(90deg,rgba(15,15,15,.99) 0%,rgba(15,15,15,.92) 45%,rgba(15,15,15,.34) 72%,rgba(15,15,15,.10) 100%),
          var(--heater-image) right center / 52% auto no-repeat;
      }

      .hero__content { width: 60%; }

      .hero__title-button {
        width: 100%;
        padding: 0;
        border: 0;
        display: flex;
        align-items: center;
        gap: 14px;
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
        color: var(--heater-orange);
        background: rgba(255,118,46,.18);
      }

      .hero__icon ha-icon { width: 32px; height: 32px; }
      .hero__titles { min-width: 0; display: flex; flex-direction: column; }

      .hero__titles strong {
        overflow: hidden;
        font-size: 29px;
        line-height: 1.05;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hero__titles small {
        margin-top: 5px;
        color: rgba(255,255,255,.56);
        font-size: 15px;
      }

      .hero__status {
        margin-top: 34px;
        color: rgba(255,255,255,.78);
        font-size: 19px;
        white-space: nowrap;
      }

      .temperature-grid {
        padding: 0 18px 14px;
        display: grid;
        grid-template-columns: repeat(2,minmax(0,1fr));
        gap: 12px;
      }

      .temperature-card {
        min-width: 0;
        height: 126px;
        padding: 16px;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 20px;
        background: rgba(255,255,255,.055);
        color: #fff;
      }

      button.temperature-card { cursor: pointer; }

      .temperature-card > small {
        display: block;
        color: rgba(255,255,255,.62);
        font-size: 13px;
        text-align: center;
      }

      .temperature-card__accent { color: var(--heater-orange) !important; }

      .temperature-value {
        height: 82px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
      }

      .temperature-value ha-icon {
        width: 23px;
        height: 23px;
        color: var(--heater-orange);
      }

      .temperature-value strong { font-size: 42px; line-height: 1; }

      .temperature-value em,
      .target-control em {
        margin-top: 12px;
        font-size: 16px;
        font-style: normal;
        font-weight: 400;
      }

      .target-control {
        height: 82px;
        display: grid;
        grid-template-columns: 44px minmax(0,1fr) 44px;
        align-items: center;
        gap: 8px;
      }

      .target-control__button {
        width: 44px;
        height: 44px;
        padding: 0;
        border: 0;
        border-radius: 50%;
        color: #fff;
        background: rgba(255,255,255,.09);
        font-size: 27px;
        cursor: pointer;
      }

      .target-control__button:active { transform: scale(.94); }

      .target-control__value {
        min-width: 0;
        padding: 0;
        border: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 4px;
        color: #fff;
        background: transparent;
        cursor: pointer;
        white-space: nowrap;
      }

      .target-control__value strong { font-size: 33px; line-height: 1; }

      .action-grid {
        padding: 0 18px 14px;
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 10px;
      }

      .action-button {
        min-width: 0;
        height: 102px;
        padding: 12px;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 20px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        color: #ddd;
        background: rgba(255,255,255,.05);
        cursor: pointer;
      }

      .action-button ha-icon { width: 30px; height: 30px; flex: 0 0 30px; }
      .action-button > span { min-width: 0; display: flex; flex-direction: column; text-align: left; }

      .action-button strong,
      .action-button small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .action-button strong { font-size: 16px; }
      .action-button small { margin-top: 4px; color: rgba(255,255,255,.55); font-size: 12px; }

      .action-button--on.is-active {
        color: #ff9b56;
        background: rgba(124,54,10,.72);
        border-color: rgba(255,129,49,.55);
      }

      .action-button--off.is-active {
        color: var(--heater-blue);
        background: rgba(30,71,91,.72);
        border-color: rgba(80,177,222,.45);
      }

      .action-button--block.is-active {
        color: var(--heater-red);
        background: rgba(83,28,28,.72);
        border-color: rgba(243,83,74,.45);
      }

      .settings-panel {
        margin: 0 18px;
        overflow: hidden;
        border: 1px solid rgba(255,255,255,.075);
        border-radius: 22px;
        background: rgba(255,255,255,.045);
      }

      .setting-row {
        min-height: 78px;
        padding: 12px 16px;
        display: grid;
        grid-template-columns: 46px minmax(0,1fr) auto;
        align-items: center;
        gap: 14px;
        border-bottom: 1px solid rgba(255,255,255,.07);
      }

      .setting-row:last-child { border-bottom: 0; }

      .setting-row__icon {
        width: 46px;
        height: 46px;
        border-radius: 50%;
        display: grid;
        place-items: center;
      }

      .setting-row__icon ha-icon { width: 24px; height: 24px; }
      .setting-row__icon--orange { color: #ff812e; background: rgba(255,129,46,.15); }
      .setting-row__icon--amber { color: var(--heater-amber); background: rgba(255,193,7,.14); }
      .setting-row__icon--blue { color: #42a5f5; background: rgba(66,165,245,.14); }
      .setting-row__icon--purple { color: #a978ff; background: rgba(169,120,255,.14); }

      .setting-row__text { min-width: 0; display: flex; flex-direction: column; }

      .setting-row__text strong,
      .setting-row__text small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .setting-row__text strong { font-size: 17px; }
      .setting-row__text small { margin-top: 4px; color: rgba(255,255,255,.52); font-size: 13px; }

      .select-control { position: relative; display: block; }

      .select-control select {
        min-width: 142px;
        height: 48px;
        padding: 0 42px 0 13px;
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 15px;
        appearance: none;
        color: #eee;
        background: #292929;
        cursor: pointer;
      }

      .select-control > ha-icon {
        position: absolute;
        top: 50%;
        right: 12px;
        width: 20px;
        height: 20px;
        color: rgba(255,255,255,.55);
        pointer-events: none;
        transform: translateY(-50%);
      }

      .power-control { display: flex; align-items: center; gap: 12px; }
      .power-bars { height: 34px; display: flex; align-items: flex-end; gap: 4px; }
      .power-bar { width: 6px; border-radius: 3px; background: rgba(255,255,255,.18); }
      .power-bar:nth-child(1) { height: 9px; }
      .power-bar:nth-child(2) { height: 14px; }
      .power-bar:nth-child(3) { height: 20px; }
      .power-bar:nth-child(4) { height: 27px; }
      .power-bar:nth-child(5) { height: 34px; }
      .power-bar.is-active { background: #ff9d18; }

      .toggle-control {
        width: 52px;
        height: 30px;
        padding: 4px;
        border: 0;
        border-radius: 18px;
        background: rgba(255,255,255,.14);
        cursor: pointer;
      }

      .toggle-control i {
        display: block;
        width: 22px;
        height: 22px;
        border-radius: 50%;
        background: #aaa;
        transition: transform .2s ease, background .2s ease;
      }

      .toggle-control.is-active { background: rgba(255,118,46,.48); }
      .toggle-control.is-active i { background: #ff9655; transform: translateX(22px); }

      .summary-grid {
        padding: 15px 18px 18px;
        display: grid;
        grid-template-columns: repeat(4,minmax(0,1fr));
        gap: 8px;
      }

      .summary-chip {
        min-width: 0;
        height: 62px;
        padding: 8px;
        border: 1px solid rgba(255,255,255,.075);
        border-radius: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 7px;
        color: #fff;
        background: rgba(255,255,255,.045);
        cursor: pointer;
      }

      .summary-chip ha-icon {
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
        color: var(--heater-orange);
      }

      .summary-chip--blue ha-icon { color: #489cff; }
      .summary-chip--amber ha-icon { color: var(--heater-amber); }
      .summary-chip > span { min-width: 0; display: flex; flex-direction: column; text-align: left; }

      .summary-chip strong,
      .summary-chip small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .summary-chip strong { font-size: 13px; }
      .summary-chip small { margin-top: 3px; color: rgba(255,255,255,.5); font-size: 10px; }

      button:focus-visible,
      select:focus-visible {
        outline: 2px solid rgba(255,135,67,.95);
        outline-offset: 2px;
      }

      @media (hover: hover) {
        .action-button:hover,
        .temperature-card--current:hover,
        .summary-chip:hover,
        .target-control__button:hover { filter: brightness(1.12); }
      }

      /* Компактная версия для телефона */
      @media (max-width: 480px) {
        .hero { height: 145px; padding: 18px; background-size: auto,47% auto; }
        .hero__content { width: 68%; }
        .hero__icon { width: 46px; height: 46px; flex-basis: 46px; }
        .hero__icon ha-icon { width: 27px; height: 27px; }
        .hero__titles strong { font-size: 22px; }
        .hero__titles small { font-size: 13px; }
        .hero__status { margin-top: 23px; font-size: 15px; }

        .temperature-grid { padding: 0 12px 10px; gap: 8px; }
        .temperature-card { height: 102px; padding: 11px; }
        .temperature-card > small { font-size: 10px; }
        .temperature-value, .target-control { height: 69px; }
        .temperature-value strong { font-size: 32px; }
        .target-control { grid-template-columns: 38px minmax(0,1fr) 38px; gap: 4px; }
        .target-control__button { width: 38px; height: 38px; }
        .target-control__value strong { font-size: 25px; }
        .temperature-value em, .target-control em { font-size: 13px; }

        .action-grid { padding: 0 12px 10px; gap: 7px; }
        .action-button { height: 78px; padding: 7px 4px; flex-direction: column; gap: 4px; }
        .action-button ha-icon { width: 24px; height: 24px; flex-basis: 24px; }
        .action-button > span { text-align: center; }
        .action-button strong { font-size: 12px; }
        .action-button small { font-size: 9px; }

        .settings-panel { margin: 0 12px; }
        .setting-row { min-height: 64px; padding: 8px 10px; grid-template-columns: 39px minmax(0,1fr) auto; gap: 9px; }
        .setting-row__icon { width: 39px; height: 39px; }
        .setting-row__icon ha-icon { width: 21px; height: 21px; }
        .setting-row__text strong { font-size: 13px; }
        .setting-row__text small { font-size: 10px; }
        .select-control select { min-width: 100px; height: 40px; padding: 0 34px 0 8px; font-size: 12px; }
        .select-control > ha-icon { right: 8px; width: 18px; height: 18px; }
        .power-bars { display: none; }

        .summary-grid { padding: 11px 12px 13px; gap: 6px; }
        .summary-chip { height: 48px; padding: 5px; gap: 4px; }
        .summary-chip ha-icon { width: 16px; height: 16px; flex-basis: 16px; }
        .summary-chip strong { font-size: 10px; }
        .summary-chip small { font-size: 7px; }
      }

      @media (max-width: 365px) {
        .hero__titles strong { font-size: 19px; }
        .hero__status { font-size: 13px; }
        .select-control select { min-width: 88px; max-width: 104px; }
        .setting-row__text strong { font-size: 12px; }
      }
    `;
  }
}

/** Регистрируем Web Component только один раз. */
if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, HeatstickHeaterCard);
}

/** Добавляем карточку в список кастомных карточек Home Assistant. */
window.customCards = window.customCards || [];

if (!window.customCards.some((card) => card.type === CARD_TAG)) {
  window.customCards.push({
    type: CARD_TAG,
    name: "Heatstick Heater Card",
    description: "Карточка управления обогревателем Heatstick",
    preview: false,
  });
}

console.info(
  `%c HEATSTICK-HEATER-CARD %c v${CARD_VERSION} `,
  "color: white; background: #ff762e; font-weight: 700;",
  "color: #ff762e; background: #1b1b1b;",
);
