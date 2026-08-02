/**
 * Heatstick Heater Card
 * Версия 1.1.0
 *
 * Главное изменение этой версии:
 * карточка больше не пересоздаёт весь Shadow DOM при каждом изменении
 * состояния Home Assistant. Меняются только текст, классы и значения
 * контролов. Поэтому целевая температура может обновляться сколько угодно
 * часто, но кнопки и select больше не исчезают из-под пальца.
 */

const CARD_TAG = "heatstick-heater-card";
const CARD_VERSION = "1.1.0";

const DEFAULT_CONFIG = Object.freeze({
  name: "Обогреватель",
  room: "Гостиная",
  image: "/local/heater.png",
  temperature_decimals: 0,

  // Реальный диапазон этого обогревателя.
  // Эти параметры имеют приоритет над некорректными атрибутами number.
  temperature_min: 18,
  temperature_max: 35,
  temperature_step: 1,

  // Небольшая задержка объединяет быстрые нажатия +/− в одну команду.
  temperature_debounce: 180,

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

const REQUIRED_ENTITY_KEYS = Object.freeze([
  "status_entity",
  "current_temperature_entity",
  "target_temperature_entity",
  "mode_entity",
  "power_entity",
  "display_entity",
  "led_entity",
]);

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

class HeatstickHeaterCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });

    this._config = null;
    this._hass = null;
    this._structureReady = false;

    // Оптимистичное значение не даёт интерфейсу прыгать между старым
    // и новым состоянием, пока ESPHome подтверждает команду.
    this._targetDraft = null;
    this._targetCommitTimer = null;
    this._targetDraftTimer = null;

    // Запоминаем состав option, чтобы не пересоздавать открытый select.
    this._selectOptionKeys = new Map();
  }

  static getStubConfig() {
    return {
      type: `custom:${CARD_TAG}`,
      ...DEFAULT_CONFIG,
    };
  }

  setConfig(config) {
    if (!config || typeof config !== "object") {
      throw new Error("Не задана конфигурация карточки");
    }

    const merged = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    for (const key of REQUIRED_ENTITY_KEYS) {
      if (!merged[key]) {
        throw new Error(`Не задан обязательный параметр: ${key}`);
      }
    }

    const min = Number(merged.temperature_min);
    const max = Number(merged.temperature_max);
    const step = Number(merged.temperature_step);

    if (!Number.isFinite(min) || !Number.isFinite(max) || min >= max) {
      throw new Error("temperature_min должен быть меньше temperature_max");
    }

    if (!Number.isFinite(step) || step <= 0) {
      throw new Error("temperature_step должен быть больше 0");
    }

    this._config = merged;
    this._structureReady = false;
    this._selectOptionKeys.clear();
    this._targetDraft = null;
    this._clearTargetTimers();

    this._ensureStructure();
    this._updateState();
  }

  set hass(hass) {
    this._hass = hass;
    this._ensureStructure();
    this._updateState();
  }

  getCardSize() {
    return 10;
  }

  disconnectedCallback() {
    this._clearTargetTimers();
  }

  _clearTargetTimers() {
    if (this._targetCommitTimer) {
      clearTimeout(this._targetCommitTimer);
      this._targetCommitTimer = null;
    }

    if (this._targetDraftTimer) {
      clearTimeout(this._targetDraftTimer);
      this._targetDraftTimer = null;
    }
  }

  _entity(entityId) {
    return this._hass?.states?.[entityId] ?? null;
  }

  _state(entityId, fallback = "unknown") {
    return this._entity(entityId)?.state ?? fallback;
  }

  _label(dictionary, value) {
    return dictionary[value] ?? value;
  }

  _formatTemperature(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";

    const decimals = Math.min(
      2,
      Math.max(0, Number(this._config?.temperature_decimals ?? 0)),
    );

    return number.toFixed(decimals);
  }

  _roundToStep(value, step, minimum) {
    const rounded = minimum + Math.round((value - minimum) / step) * step;
    return Number(rounded.toFixed(4));
  }

  _temperatureLimits() {
    return {
      minimum: Number(this._config.temperature_min),
      maximum: Number(this._config.temperature_max),
      step: Number(this._config.temperature_step),
    };
  }

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
   * Меняет целевую температуру локально сразу.
   * Команда в Home Assistant отправляется с debounce, поэтому серия быстрых
   * нажатий не создаёт очередь из конфликтующих set_value.
   */
  _changeTargetTemperature(direction) {
    const entity = this._entity(this._config.target_temperature_entity);
    const actual = Number(entity?.state);
    const { minimum, maximum, step } = this._temperatureLimits();

    const base = Number.isFinite(this._targetDraft)
      ? this._targetDraft
      : actual;

    if (!Number.isFinite(base)) {
      this._showNotification("Целевая температура недоступна");
      return;
    }

    const next = this._roundToStep(
      Math.min(maximum, Math.max(minimum, base + direction * step)),
      step,
      minimum,
    );

    this._targetDraft = next;
    this._updateTargetOnly();

    if (this._targetCommitTimer) {
      clearTimeout(this._targetCommitTimer);
    }

    const delay = Math.max(
      0,
      Number(this._config.temperature_debounce ?? 180),
    );

    this._targetCommitTimer = setTimeout(() => {
      this._targetCommitTimer = null;
      this._commitTargetTemperature();
    }, delay);
  }

  async _commitTargetTemperature() {
    if (!Number.isFinite(this._targetDraft)) return;

    const requestedValue = this._targetDraft;

    await this._callService("number", "set_value", {
      entity_id: this._config.target_temperature_entity,
      value: requestedValue,
    });

    // До 2 секунд игнорируем запоздалые старые значения от ESPHome.
    if (this._targetDraftTimer) {
      clearTimeout(this._targetDraftTimer);
    }

    this._targetDraftTimer = setTimeout(() => {
      this._targetDraft = null;
      this._targetDraftTimer = null;
      this._updateTargetOnly();
    }, 2000);
  }

  _ensureStructure() {
    if (
      this._structureReady ||
      !this._config ||
      !this._hass
    ) {
      return;
    }

    this.shadowRoot.innerHTML = `
      <style>${this._styles()}</style>

      <ha-card class="heater-card">
        <section class="hero" id="hero">
          <div class="hero__content">
            <button class="hero__title-button" id="header-button" type="button">
              <span class="hero__icon">
                <ha-icon icon="mdi:radiator"></ha-icon>
              </span>
              <span class="hero__titles">
                <strong id="title"></strong>
                <small id="room"></small>
              </span>
            </button>
            <div class="hero__status" id="hero-status"></div>
          </div>
        </section>

        <section class="temperature-grid">
          <button
            class="temperature-card temperature-card--current"
            id="current-temperature-button"
            type="button"
          >
            <small>Текущая температура</small>
            <span class="temperature-value">
              <ha-icon icon="mdi:thermometer"></ha-icon>
              <strong id="current-temperature"></strong>
              <em>°C</em>
            </span>
          </button>

          <div class="temperature-card temperature-card--target">
            <small class="temperature-card__accent">
              Целевая температура
            </small>

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
                <strong id="target-temperature"></strong>
                <em>°C</em>
              </button>

              <button
                class="target-control__button"
                id="target-plus"
                type="button"
                aria-label="Увеличить целевую температуру"
              >+</button>
            </div>

            <div class="temperature-range" id="temperature-range"></div>
          </div>
        </section>

        <section class="action-grid">
          <button
            class="action-button action-button--on"
            id="status-on"
            type="button"
          >
            <ha-icon icon="mdi:power"></ha-icon>
            <span><strong>Включить</strong><small>Обогрев</small></span>
          </button>

          <button
            class="action-button action-button--off"
            id="status-off"
            type="button"
          >
            <ha-icon icon="mdi:stop-circle-outline"></ha-icon>
            <span><strong>Выключить</strong><small>Остановить</small></span>
          </button>

          <button
            class="action-button action-button--block"
            id="status-block"
            type="button"
          >
            <ha-icon icon="mdi:lock-outline"></ha-icon>
            <span><strong>Блокировка</strong><small>Защита</small></span>
          </button>
        </section>

        <section class="settings-panel">
          ${this._settingRowTemplate({
            icon: "mdi:home-thermometer",
            colorClass: "orange",
            title: "Режим работы",
            textId: "mode-text",
            selectId: "mode-select",
            label: "Режим работы",
          })}

          ${this._settingRowTemplate({
            icon: "mdi:lightning-bolt",
            colorClass: "amber",
            title: "Мощность",
            textId: "power-text",
            selectId: "power-select",
            label: "Мощность",
            extra: '<span class="power-bars" id="power-bars"></span>',
          })}

          ${this._settingRowTemplate({
            icon: "mdi:monitor",
            colorClass: "blue",
            title: "Дисплей",
            textId: "display-text",
            selectId: "display-select",
            label: "Дисплей",
          })}

          <div class="setting-row">
            <span class="setting-row__icon setting-row__icon--purple">
              <ha-icon icon="mdi:lightbulb-outline"></ha-icon>
            </span>
            <span class="setting-row__text">
              <strong>Подсветка</strong>
              <small id="led-text"></small>
            </span>
            <button
              class="toggle-control"
              id="led-toggle"
              type="button"
              role="switch"
              aria-label="Переключить подсветку"
            ><i></i></button>
          </div>
        </section>

        <section class="summary-grid">
          ${this._summaryTemplate(
            "summary-current",
            "mdi:thermometer",
            "summary-current-value",
            "Текущая",
            "",
          )}
          ${this._summaryTemplate(
            "summary-target",
            "mdi:target",
            "summary-target-value",
            "Цель",
            "summary-chip--blue",
          )}
          ${this._summaryTemplate(
            "summary-power",
            "mdi:lightning-bolt",
            "summary-power-value",
            "Мощность",
            "summary-chip--amber",
          )}
          ${this._summaryTemplate(
            "summary-mode",
            "mdi:home-thermometer",
            "summary-mode-value",
            "Режим",
            "",
          )}
        </section>
      </ha-card>
    `;

    this._structureReady = true;
    this._applyStaticConfig();
    this._bindEvents();
  }

  _settingRowTemplate({
    icon,
    colorClass,
    title,
    textId,
    selectId,
    label,
    extra = "",
  }) {
    return `
      <div class="setting-row">
        <span class="setting-row__icon setting-row__icon--${colorClass}">
          <ha-icon icon="${icon}"></ha-icon>
        </span>
        <span class="setting-row__text">
          <strong>${title}</strong>
          <small id="${textId}"></small>
        </span>
        <span class="setting-row__control">
          <label class="select-control">
            <select id="${selectId}" aria-label="${label}"></select>
            <ha-icon icon="mdi:chevron-down"></ha-icon>
          </label>
          ${extra}
        </span>
      </div>
    `;
  }

  _summaryTemplate(id, icon, valueId, label, className) {
    return `
      <button class="summary-chip ${className}" id="${id}" type="button">
        <ha-icon icon="${icon}"></ha-icon>
        <span><strong id="${valueId}"></strong><small>${label}</small></span>
      </button>
    `;
  }

  _applyStaticConfig() {
    this._setText("title", this._config.name);
    this._setText("room", this._config.room);

    const hero = this.shadowRoot.getElementById("hero");
    const image = String(this._config.image ?? DEFAULT_CONFIG.image)
      .replace(/"/g, '\\"');

    hero?.style.setProperty("--heater-image", `url("${image}")`);

    const { minimum, maximum } = this._temperatureLimits();
    this._setText("temperature-range", `${minimum}–${maximum} °C`);
  }

  _setText(id, value) {
    const element = this.shadowRoot.getElementById(id);
    if (element && element.textContent !== String(value)) {
      element.textContent = String(value);
    }
  }

  _toggleClass(id, className, enabled) {
    this.shadowRoot
      .getElementById(id)
      ?.classList.toggle(className, Boolean(enabled));
  }

  _updateState() {
    if (!this._structureReady || !this._config || !this._hass) return;

    const c = this._config;
    const status = this._state(c.status_entity);
    const current = this._formatTemperature(
      this._state(c.current_temperature_entity),
    );
    const targetActual = Number(this._state(c.target_temperature_entity));
    const mode = this._state(c.mode_entity);
    const power = this._state(c.power_entity);
    const display = this._state(c.display_entity);
    const led = this._state(c.led_entity);

    // Когда устройство подтвердило именно наше значение, draft больше не нужен.
    if (
      Number.isFinite(this._targetDraft) &&
      Number.isFinite(targetActual) &&
      Math.abs(targetActual - this._targetDraft) < 0.001
    ) {
      this._targetDraft = null;
      if (this._targetDraftTimer) {
        clearTimeout(this._targetDraftTimer);
        this._targetDraftTimer = null;
      }
    }

    this._setText(
      "hero-status",
      `${this._label(STATUS_LABELS, status)} · ${current} °C`,
    );
    this._setText("current-temperature", current);
    this._setText("summary-current-value", `${current} °C`);

    this._toggleClass("status-on", "is-active", status === "on");
    this._toggleClass("status-off", "is-active", status === "off");
    this._toggleClass("status-block", "is-active", status === "block");

    this._setText("mode-text", this._label(MODE_LABELS, mode));
    this._setText("power-text", this._label(POWER_LABELS, power));
    this._setText("display-text", this._label(DISPLAY_LABELS, display));
    this._setText("led-text", led === "on" ? "Включена" : "Выключена");

    this._toggleClass("led-toggle", "is-active", led === "on");
    this.shadowRoot
      .getElementById("led-toggle")
      ?.setAttribute("aria-checked", String(led === "on"));

    this._updateSelect(
      "mode-select",
      c.mode_entity,
      mode,
      MODE_LABELS,
    );
    this._updateSelect(
      "power-select",
      c.power_entity,
      power,
      POWER_LABELS,
    );
    this._updateSelect(
      "display-select",
      c.display_entity,
      display,
      DISPLAY_LABELS,
    );

    this._updatePowerBars(power);

    this._setText("summary-power-value", this._label(POWER_LABELS, power));
    this._setText("summary-mode-value", this._label(MODE_LABELS, mode));

    this._updateTargetOnly();
  }

  _updateTargetOnly() {
    if (!this._structureReady || !this._config || !this._hass) return;

    const actual = Number(
      this._state(this._config.target_temperature_entity),
    );

    const shown = Number.isFinite(this._targetDraft)
      ? this._targetDraft
      : actual;

    const formatted = this._formatTemperature(shown);
    this._setText("target-temperature", formatted);
    this._setText("summary-target-value", `${formatted} °C`);

    const { minimum, maximum } = this._temperatureLimits();
    const minus = this.shadowRoot.getElementById("target-minus");
    const plus = this.shadowRoot.getElementById("target-plus");

    if (minus) minus.disabled = !Number.isFinite(shown) || shown <= minimum;
    if (plus) plus.disabled = !Number.isFinite(shown) || shown >= maximum;
  }

  /**
   * Перестраиваем option только если их состав действительно изменился.
   * Во время открытого select Home Assistant не может уничтожить контрол.
   */
  _updateSelect(selectId, entityId, currentValue, labels) {
    const select = this.shadowRoot.getElementById(selectId);
    if (!select) return;

    const entityOptions = this._entity(entityId)?.attributes?.options;
    const options = Array.isArray(entityOptions) && entityOptions.length
      ? entityOptions
      : [currentValue];

    const optionKey = JSON.stringify(options);
    const previousKey = this._selectOptionKeys.get(selectId);

    if (optionKey !== previousKey) {
      const fragment = document.createDocumentFragment();

      for (const value of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = this._label(labels, value);
        fragment.appendChild(option);
      }

      select.replaceChildren(fragment);
      this._selectOptionKeys.set(selectId, optionKey);
    }

    // Не меняем значение select, пока пользователь держит его открытым.
    if (this.shadowRoot.activeElement !== select) {
      select.value = currentValue;
    }
  }

  _updatePowerBars(power) {
    const powerLevel = power === "auto"
      ? 5
      : Number(String(power).replace("lev", "")) || 0;

    const container = this.shadowRoot.getElementById("power-bars");
    if (!container) return;

    if (!container.children.length) {
      for (let level = 1; level <= 5; level += 1) {
        const bar = document.createElement("i");
        bar.className = "power-bar";
        bar.dataset.level = String(level);
        container.appendChild(bar);
      }
    }

    for (const bar of container.children) {
      bar.classList.toggle(
        "is-active",
        Number(bar.dataset.level) <= powerLevel,
      );
    }
  }

  _bindEvents() {
    const c = this._config;
    const root = this.shadowRoot;

    root.getElementById("header-button")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.status_entity),
    );

    root.getElementById("current-temperature-button")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.current_temperature_entity),
    );

    root.getElementById("target-temperature-button")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.target_temperature_entity),
    );

    root.getElementById("target-minus")?.addEventListener(
      "click",
      () => this._changeTargetTemperature(-1),
    );

    root.getElementById("target-plus")?.addEventListener(
      "click",
      () => this._changeTargetTemperature(1),
    );

    root.getElementById("status-on")?.addEventListener(
      "click",
      () => this._setSelect(c.status_entity, "on"),
    );

    root.getElementById("status-off")?.addEventListener(
      "click",
      () => this._setSelect(c.status_entity, "off"),
    );

    root.getElementById("status-block")?.addEventListener(
      "click",
      () => this._setSelect(c.status_entity, "block"),
    );

    root.getElementById("mode-select")?.addEventListener(
      "change",
      (event) => this._setSelect(c.mode_entity, event.target.value),
    );

    root.getElementById("power-select")?.addEventListener(
      "change",
      (event) => this._setSelect(c.power_entity, event.target.value),
    );

    root.getElementById("display-select")?.addEventListener(
      "change",
      (event) => this._setSelect(c.display_entity, event.target.value),
    );

    root.getElementById("led-toggle")?.addEventListener(
      "click",
      () => this._toggleSwitch(c.led_entity),
    );

    root.getElementById("summary-current")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.current_temperature_entity),
    );

    root.getElementById("summary-target")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.target_temperature_entity),
    );

    root.getElementById("summary-power")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.power_entity),
    );

    root.getElementById("summary-mode")?.addEventListener(
      "click",
      () => this._openMoreInfo(c.mode_entity),
    );
  }

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
      button {
        -webkit-tap-highlight-color: transparent;
        touch-action: manipulation;
        user-select: none;
      }

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
          linear-gradient(
            90deg,
            rgba(15,15,15,.99) 0%,
            rgba(15,15,15,.92) 45%,
            rgba(15,15,15,.34) 72%,
            rgba(15,15,15,.10) 100%
          ),
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
        position: relative;
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

      .temperature-card__accent {
        color: var(--heater-orange) !important;
      }

      .temperature-range {
        position: absolute;
        right: 0;
        bottom: 5px;
        left: 0;
        color: rgba(255,255,255,.30);
        font-size: 9px;
        text-align: center;
        pointer-events: none;
      }

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

      .temperature-value strong {
        font-size: 42px;
        line-height: 1;
      }

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

      .target-control__button:disabled {
        opacity: .28;
        cursor: default;
        transform: none;
      }

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

      .target-control__value strong {
        font-size: 33px;
        line-height: 1;
      }

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

      .action-button ha-icon {
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
      }

      .action-button > span {
        min-width: 0;
        display: flex;
        flex-direction: column;
        text-align: left;
      }

      .action-button strong,
      .action-button small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .action-button strong { font-size: 16px; }

      .action-button small {
        margin-top: 4px;
        color: rgba(255,255,255,.55);
        font-size: 12px;
      }

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
      .setting-row__icon--orange {
        color: #ff812e;
        background: rgba(255,129,46,.15);
      }
      .setting-row__icon--amber {
        color: var(--heater-amber);
        background: rgba(255,193,7,.14);
      }
      .setting-row__icon--blue {
        color: #42a5f5;
        background: rgba(66,165,245,.14);
      }
      .setting-row__icon--purple {
        color: #a978ff;
        background: rgba(169,120,255,.14);
      }

      .setting-row__text {
        min-width: 0;
        display: flex;
        flex-direction: column;
      }

      .setting-row__text strong,
      .setting-row__text small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .setting-row__text strong { font-size: 17px; }

      .setting-row__text small {
        margin-top: 4px;
        color: rgba(255,255,255,.52);
        font-size: 13px;
      }

      .setting-row__control {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .select-control {
        position: relative;
        display: block;
      }

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

      .power-bars {
        height: 34px;
        display: flex;
        align-items: flex-end;
        gap: 4px;
      }

      .power-bar {
        width: 6px;
        border-radius: 3px;
        background: rgba(255,255,255,.18);
      }

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

      .toggle-control.is-active {
        background: rgba(255,118,46,.48);
      }

      .toggle-control.is-active i {
        background: #ff9655;
        transform: translateX(22px);
      }

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

      .summary-chip > span {
        min-width: 0;
        display: flex;
        flex-direction: column;
        text-align: left;
      }

      .summary-chip strong,
      .summary-chip small {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .summary-chip strong { font-size: 13px; }

      .summary-chip small {
        margin-top: 3px;
        color: rgba(255,255,255,.5);
        font-size: 10px;
      }

      button:focus-visible,
      select:focus-visible {
        outline: 2px solid rgba(255,135,67,.95);
        outline-offset: 2px;
      }

      @media (hover: hover) {
        .action-button:hover,
        .temperature-card--current:hover,
        .summary-chip:hover,
        .target-control__button:hover {
          filter: brightness(1.12);
        }
      }

      @media (max-width: 480px) {
        .hero {
          height: 145px;
          padding: 18px;
          background-size: auto,47% auto;
        }

        .hero__content { width: 68%; }
        .hero__icon {
          width: 46px;
          height: 46px;
          flex-basis: 46px;
        }
        .hero__icon ha-icon { width: 27px; height: 27px; }
        .hero__titles strong { font-size: 22px; }
        .hero__titles small { font-size: 13px; }
        .hero__status { margin-top: 23px; font-size: 15px; }

        .temperature-grid {
          padding: 0 12px 10px;
          gap: 8px;
        }

        .temperature-card {
          height: 102px;
          padding: 11px;
        }

        .temperature-card > small { font-size: 10px; }
        .temperature-value,
        .target-control { height: 69px; }
        .temperature-value strong { font-size: 32px; }

        .target-control {
          grid-template-columns: 38px minmax(0,1fr) 38px;
          gap: 4px;
        }

        .target-control__button {
          width: 38px;
          height: 38px;
        }

        .target-control__value strong { font-size: 25px; }

        .temperature-value em,
        .target-control em { font-size: 13px; }

        .action-grid {
          padding: 0 12px 10px;
          gap: 7px;
        }

        .action-button {
          height: 78px;
          padding: 7px 4px;
          flex-direction: column;
          gap: 4px;
        }

        .action-button ha-icon {
          width: 24px;
          height: 24px;
          flex-basis: 24px;
        }

        .action-button > span { text-align: center; }
        .action-button strong { font-size: 12px; }
        .action-button small { font-size: 9px; }

        .settings-panel { margin: 0 12px; }

        .setting-row {
          min-height: 64px;
          padding: 8px 10px;
          grid-template-columns: 39px minmax(0,1fr) auto;
          gap: 9px;
        }

        .setting-row__icon {
          width: 39px;
          height: 39px;
        }

        .setting-row__icon ha-icon {
          width: 21px;
          height: 21px;
        }

        .setting-row__text strong { font-size: 13px; }
        .setting-row__text small { font-size: 10px; }

        .setting-row__control { gap: 0; }

        .select-control select {
          min-width: 100px;
          max-width: 118px;
          height: 40px;
          padding: 0 34px 0 8px;
          font-size: 12px;
        }

        .select-control > ha-icon {
          right: 8px;
          width: 18px;
          height: 18px;
        }

        .power-bars { display: none; }

        .summary-grid {
          padding: 11px 12px 13px;
          gap: 6px;
        }

        .summary-chip {
          height: 48px;
          padding: 5px;
          gap: 4px;
        }

        .summary-chip ha-icon {
          width: 16px;
          height: 16px;
          flex-basis: 16px;
        }

        .summary-chip strong { font-size: 10px; }
        .summary-chip small { font-size: 7px; }
      }

      @media (max-width: 365px) {
        .hero__titles strong { font-size: 19px; }
        .hero__status { font-size: 13px; }

        .select-control select {
          min-width: 88px;
          max-width: 104px;
        }

        .setting-row__text strong { font-size: 12px; }
      }
    `;
  }
}

if (!customElements.get(CARD_TAG)) {
  customElements.define(CARD_TAG, HeatstickHeaterCard);
}

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
  "color:white;background:#ff762e;font-weight:700;",
  "color:#ff762e;background:#1b1b1b;",
);