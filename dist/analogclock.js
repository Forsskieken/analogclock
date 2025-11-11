class AnalogClock extends HTMLElement {
  set hass(hass) {
    const formatStackTrace = (stack = "") =>
      stack.split("\n").map((line) => line.trim());

    if (this.content) return; // build once

    console.info(
      "%c ANALOG-CLOCK v3.10 ",
      "color: white; font-weight: bold; background: black"
    );

    const host = this;
    const config = this.config || {};

    const card = document.createElement("ha-card");
    const content = document.createElement("div");
    content.style.display = "flex";
    content.style.justifyContent = "center";
    content.style.padding = "5px";

    const canvas = document.createElement("canvas");

    // --- diameter parsing ---
    const minSize = 100;
    const maxSize = 2000;
    let fixedPx = null; // explicit px diameter
    let cssLength = null; // CSS length (vh, dvh, %, var(), etc.)

    if (config.diameter !== undefined && config.diameter !== null) {
      const d = config.diameter;
      if (typeof d === "number") {
        fixedPx = d;
      } else if (typeof d === "string") {
        const t = d.trim();
        const m = t.match(/^(\d+)(px)?$/); // "400" or "400px"
        if (m) {
          fixedPx = parseInt(m[1], 10);
        } else {
          cssLength = t;
        }
      }
    }

    if (fixedPx !== null) {
      fixedPx = Math.max(minSize, Math.min(fixedPx, maxSize));
      canvas.style.width = fixedPx + "px";
      canvas.style.height = fixedPx + "px";
    } else if (cssLength) {
      canvas.style.width = cssLength; // height synced in JS
    }

    content.appendChild(canvas);
    card.appendChild(content);
    host.appendChild(card);
    this.content = content;

    // --- canvases & shared size state ---
    let size = 220;
    let radius = 0;
    let needsFullRedraw = true;

    const ctx = canvas.getContext("2d");

    const canvasHourEl = document.createElement("canvas");
    const layerHourCtx = canvasHourEl.getContext("2d");

    const canvasMinSecEl = document.createElement("canvas");
    const layerMinSecCtx = canvasMinSecEl.getContext("2d");

    function applyLayerTransforms() {
      // hour layer
      canvasHourEl.width = size;
      canvasHourEl.height = size;
      layerHourCtx.setTransform(1, 0, 0, 1, 0, 0);
      layerHourCtx.textAlign = "center";
      layerHourCtx.textBaseline = "middle";
      layerHourCtx.translate(size / 2, size / 2);

      // min/sec layer
      canvasMinSecEl.width = size;
      canvasMinSecEl.height = size;
      layerMinSecCtx.setTransform(1, 0, 0, 1, 0, 0);
      layerMinSecCtx.textAlign = "center";
      layerMinSecCtx.textBaseline = "middle";
      layerMinSecCtx.translate(size / 2, size / 2);
    }

    const updateSize = (fromWidth) => {
      let target;

      if (fixedPx !== null) {
        target = fixedPx;
      } else {
        const parent = content.parentElement || content;
        const rect = parent.getBoundingClientRect();

        const w = fromWidth || rect.width || 0;
        const h = rect.height || w || 0;

        const base =
          w && h
            ? Math.min(w, h)
            : w || h || Math.min(window.innerWidth, window.innerHeight);

        target = Math.max(minSize, Math.min(base, maxSize));
      }

      if (!target) target = 220;
      if (target === size && radius) return;

      size = target;
      radius = size / 2.06;

      canvas.width = size;
      canvas.height = size;
      if (fixedPx === null) {
        canvas.style.height = size + "px";
      }

      applyLayerTransforms();

      // <- key fix: size change wiped layers, so force redraw
      needsFullRedraw = true;
    };

    // initial sizing
    updateSize();

    // responsive for CSS-based diameters
    if (fixedPx === null && typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (!entry) return;
        const w = entry.contentRect.width;
        if (!w) return;
        window.requestAnimationFrame(() => updateSize(w));
      });
      ro.observe(content);
      host._resizeObserver = ro;
    } else if (fixedPx === null) {
      window.addEventListener("resize", () => updateSize(), {
        passive: true,
      });
    }

    // --- config & drawing state ---
    let color_Background =
      getComputedStyle(document.documentElement).getPropertyValue(
        "--primary-background-color"
      ) || "#000";
    let color_Ticks = "Silver";
    let hide_MinorTicks = false;
    let hide_MajorTicks = false;
    let color_FaceDigits = "Silver";
    let locale = hass.language || "en-US";
    let color_DigitalTime = "red";
    let color_HourHand = "#CCCCCC";
    let color_MinuteHand = "#EEEEEE";
    let color_SecondHand = "Silver";
    let color_Time = "Silver";
    let color_Text = "Silver";
    let timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    let timezonedisplayname = "";
    let showtimezone = false;
    let hide_WeekNumber = true;
    let hide_FaceDigits = false;
    let hide_Date = false;
    let hide_WeekDay = false;
    let hide_DigitalTime = false;
    let hide_SecondHand = false;
    let style_HourHand = 1;
    let style_MinuteHand = 1;
    let style_SecondHand = 3;
    let dateMask = "";
    let timeFormat = "";
    let demo = false;

    let layerCachedForMinute = null;

    getConfig();

    // --- dateFormat helper (unchanged API) ---
    const dateFormat = (function () {
      const token =
          /d{1,4}|m{1,4}|yy(?:yy)?|([HhMsTt])\1?|[LloSZ]|"[^"]*"|'[^']*'/g,
        tz =
          /\b(?:[PMCEA][SDP]T|(?:Pacific|Mountain|Central|Eastern|Atlantic) (?:Standard|Daylight|Prevailing) Time|(?:GMT|UTC)(?:[-+]\d{4})?)\b/g,
        tzClip = /[^-+\dA-Z]/g,
        pad = (val, len = 2) => {
          val = String(val);
          while (val.length < len) val = "0" + val;
          return val;
        };

      function _fmt(date, mask, utc) {
        if (
          arguments.length === 1 &&
          Object.prototype.toString.call(date) === "[object String]" &&
          !/\d/.test(date)
        ) {
          mask = date;
          date = undefined;
        }

        date = date ? new Date(date) : new Date();
        if (isNaN(date)) throw SyntaxError("invalid date");

        mask = String(_fmt.masks[mask] || mask || _fmt.masks.default);

        if (mask.slice(0, 4) === "UTC:") {
          mask = mask.slice(4);
          utc = true;
        }

        const _ = utc ? "getUTC" : "get",
          d = date[_ + "Date"](),
          m = date[_ + "Month"](),
          y = date[_ + "FullYear"](),
          H = date[_ + "Hours"](),
          M = date[_ + "Minutes"](),
          s = date[_ + "Seconds"](),
          L = date[_ + "Milliseconds"](),
          o = utc ? 0 : date.getTimezoneOffset(),
          flags = {
            d,
            dd: pad(d),
            ddd: intlDay("short"),
            dddd: intlDay("long"),
            m: m + 1,
            mm: pad(m + 1),
            mmm: intlMonth("short"),
            mmmm: intlMonth("long"),
            yy: String(y).slice(2),
            yyyy: y,
            h: H % 12 || 12,
            hh: pad(H % 12 || 12),
            H,
            HH: pad(H),
            M,
            MM: pad(M),
            s,
            ss: pad(s),
            l: pad(L, 3),
            L: pad(L > 99 ? Math.round(L / 10) : L),
            t: H < 12 ? "a" : "p",
            tt: H < 12 ? "am" : "pm",
            T: H < 12 ? "A" : "P",
            TT: H < 12 ? "AM" : "PM",
            Z: utc
              ? "UTC"
              : (String(date).match(tz) || [""]).pop().replace(tzClip, ""),
            o:
              (o > 0 ? "-" : "+") +
              pad(
                Math.floor(Math.abs(o) / 60) * 100 + (Math.abs(o) % 60),
                4
              ),
            S: ["th", "st", "nd", "rd"][
              d % 10 > 3
                ? 0
                : (d % 100 - (d % 10) !== 10) * (d % 10)
            ],
          };

        return mask.replace(token, ($0) =>
          $0 in flags ? flags[$0] : $0.slice(1, -1)
        );
      }

      _fmt.masks = {
        default: "ddd mmm dd yyyy HH:MM:ss",
        shortDate: "m/d/yy",
        mediumDate: "mmm d, yyyy",
        longDate: "mmmm d, yyyy",
        fullDate: "dddd, mmmm d, yyyy",
        shortTime: "h:MM TT",
        mediumTime: "h:MM:ss TT",
        longTime: "h:MM:ss TT Z",
        isoDate: "yyyy-mm-dd",
        isoTime: "HH:MM:ss",
        isoDateTime: "yyyy-mm-dd'T'HH:MM:ss",
        isoUtcDateTime: "UTC:yyyy-mm-dd'T'HH:MM:ss'Z'",
      };

      return _fmt;
    })();

    Date.prototype.format = function (mask, utc) {
      return dateFormat(this, mask, utc);
    };

    function intlMonth(length) {
      return new Date().toLocaleDateString(locale, { month: length });
    }

    function intlDay(length) {
      return new Date().toLocaleDateString(locale, { weekday: length });
    }

    // --- main loop ---
    drawClock();
    setInterval(drawClock, hide_SecondHand ? 10000 : 1000);

    function drawClock() {
      try {
        let now = new Date();
        if (config.timezone) timezone = config.timezone;

        const opts = (part) => ({
          [part]: "numeric",
          timeZone: timezone,
        });

        const year = now.toLocaleString("sv-SE", opts("year"));
        const month = now.toLocaleString("sv-SE", opts("month"));
        const day = now.toLocaleString("sv-SE", opts("day"));
        const hour = now.toLocaleString("sv-SE", opts("hour"));
        const minute = now.toLocaleString("sv-SE", opts("minute"));
        const second = now.toLocaleString("sv-SE", opts("second"));

        now = new Date(year, month - 1, day, hour, minute, second);
        if (demo) now = new Date(2021, 1, 10, 10, 8, 20);

        const minuteKey = now.toLocaleTimeString("sv-SE", {
          minute: "2-digit",
          hour12: false,
        });

        // redraw face when minute changes OR after resize
        if (needsFullRedraw || layerCachedForMinute !== minuteKey) {
          needsFullRedraw = false;
          layerCachedForMinute = minuteKey;

          layerHourCtx.clearRect(
            -size,
            -size,
            size * 2,
            size * 2
          );

          drawFace(layerHourCtx, radius, color_Background);
          drawTicks(layerHourCtx, radius, color_Ticks);
          if (!hide_FaceDigits)
            drawFaceDigits(
              layerHourCtx,
              radius,
              color_FaceDigits
            );
          if (!hide_Date)
            drawDate(
              layerHourCtx,
              now,
              locale,
              radius,
              color_Text
            );
          if (!hide_WeekDay)
            drawWeekday(
              layerHourCtx,
              now,
              locale,
              radius,
              color_Text
            );
          if (!hide_WeekNumber)
            drawWeeknumber(
              layerHourCtx,
              now,
              locale,
              radius,
              color_Text
            );
          if (!hide_DigitalTime)
            drawTime(
              layerHourCtx,
              now,
              locale,
              radius,
              color_DigitalTime
            );

          const hh = Number(
            now
              .toLocaleTimeString("sv-SE", {
                hour: "2-digit",
                hour12: false,
              })
              .slice(0, 2)
          );
          const mm = Number(minuteKey);
          drawHand(
            layerHourCtx,
            (hh + mm / 60) * 30,
            radius * 0.5,
            radius / 20,
            color_HourHand,
            style_HourHand
          );
        }

        // minute + second hands layer
        layerMinSecCtx.clearRect(
          -size,
          -size,
          size * 2,
          size * 2
        );

        const mmNum = Number(
          now.toLocaleTimeString("sv-SE", {
            minute: "2-digit",
            hour12: false,
          })
        );

        drawHand(
          layerMinSecCtx,
          (mmNum + now.getSeconds() / 60) * 6,
          radius * 0.8,
          radius / 20,
          color_MinuteHand,
          style_MinuteHand
        );

        if (!hide_SecondHand) {
          drawHand(
            layerMinSecCtx,
            now.getSeconds() * 6,
            radius * 0.8,
            0,
            color_SecondHand,
            style_SecondHand
          );
        }

        // composite
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(canvasHourEl, 0, 0, size, size);
        ctx.drawImage(canvasMinSecEl, 0, 0, size, size);
      } catch (err) {
        showerror(err, ctx, radius);
      }
    }

    // --- drawing helpers (unchanged logic) ---
    function drawFace(ctx, radius, color) {
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.arc(0, 0, radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.lineWidth = radius * 0.03;
      ctx.stroke();
    }

    function drawTicks(ctx, radius, color) {
      let ang, num;
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      if (!hide_MajorTicks) {
        for (num = 1; num < 13; num++) {
          ang = (num * Math.PI) / 6;
          ctx.moveTo(Math.cos(ang) * radius, Math.sin(ang) * radius);
          ctx.lineTo(
            Math.cos(ang) * radius * 0.9,
            Math.sin(ang) * radius * 0.9
          );
          ctx.stroke();
        }
      }
      ctx.lineWidth = 1;
      if (!hide_MinorTicks) {
        for (num = 1; num < 60; num++) {
          ang = (num * Math.PI) / 30;
          ctx.moveTo(Math.cos(ang) * radius, Math.sin(ang) * radius);
          ctx.lineTo(
            Math.cos(ang) * radius * 0.95,
            Math.sin(ang) * radius * 0.95
          );
          ctx.stroke();
        }
      }
    }

    function drawFaceDigits(ctx, radius, color) {
      let ang, num;
      ctx.lineWidth = 2;
      ctx.fillStyle = color;
      ctx.font = Math.round(radius / 7) + "px Sans-Serif";
      for (num = 1; num < 13; num++) {
        ang =
          (num * Math.PI) / 6 -
          ((2 * Math.PI) / 12) * 3;
        ctx.fillText(
          num,
          Math.cos(ang) * radius * 0.8,
          Math.sin(ang) * radius * 0.8
        );
        ctx.stroke();
      }
    }

    function drawHand(ctx, ang, length, width, color, style) {
      const angrad = ((ang - 90) * Math.PI) / 180;
      width = width > 0 ? width : 1;
      ctx.beginPath();
      ctx.strokeStyle = color;
      ctx.fillStyle = color;

      let Coords;
      switch (style) {
        default:
          Coords = getCoords(length, 0, angrad);
          ctx.moveTo(Coords.x, Coords.y);
          Coords = getCoords(0, -width, angrad);
          ctx.lineTo(Coords.x, Coords.y);
          Coords = getCoords(-width * 1.5, 0, angrad);
          ctx.lineTo(Coords.x, Coords.y);
          Coords = getCoords(0, width, angrad);
          ctx.lineTo(Coords.x, Coords.y);
          ctx.closePath();
          ctx.fill();
          break;
        case 3:
          ctx.lineWidth = 3;
          Coords = getCoords(1, 0, angrad);
          ctx.moveTo(Coords.x, Coords.y);
          Coords = getCoords(length, 0, angrad);
          ctx.lineTo(Coords.x, Coords.y);
          ctx.closePath();
          ctx.fill();
          break;
      }

      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, length / 40, 0, 2 * Math.PI);
      ctx.fillStyle = "#777777";
      ctx.fill();
      ctx.stroke();
    }

    function getCoords(xin, yin, angin) {
      const r = Math.sqrt(xin * xin + yin * yin);
      const ang = Math.atan2(yin, xin) + angin;
      return { x: r * Math.cos(ang), y: r * Math.sin(ang) };
    }

    function drawWeekday(ctx, now, locale, radius, color) {
      ctx.font = Math.round(radius / 7) + "px Sans-Serif";
      ctx.fillStyle = color;
      if (showtimezone) {
        ctx.fillText(
          timezonedisplayname || timezone,
          0,
          radius * 0.3
        );
      } else {
        ctx.fillText(
          now.toLocaleDateString(locale, { weekday: "long" }),
          0,
          radius * 0.3
        );
      }
      ctx.stroke();
    }

    function drawWeeknumber(ctx, now, locale, radius, color) {
      ctx.font = Math.round(radius / 7) + "px Sans-Serif";
      ctx.fillStyle = color;
      ctx.fillText(weekNumber(), radius * -0.5, 0);
      ctx.stroke();
    }

    function drawTime(ctx, now, locale, radius, color) {
      let timeString = now.toLocaleTimeString(locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
      if (timeFormat) {
        try {
          timeString = dateFormat(now, timeFormat);
        } catch (err) {
          showerror(err, ctx, radius);
        }
      }
      ctx.font =
        Math.round(radius / (timeString.length > 5 ? 5 : 3)) +
        "px Sans-Serif";
      ctx.fillStyle = color;
      ctx.fillText(timeString, 0, radius * -0.4);
      ctx.stroke();
    }

    function drawDate(ctx, now, locale, radius, color) {
      ctx.font = Math.round(radius / 7) + "px Sans-Serif";
      ctx.fillStyle = color;
      if (dateMask) {
        try {
          ctx.fillText(
            dateFormat(now, dateMask),
            0,
            radius * 0.5
          );
        } catch (err) {
          showerror(err, ctx, radius);
        }
      } else {
        ctx.fillText(
          now.toLocaleDateString(locale),
          0,
          radius * 0.5
        );
      }
      ctx.stroke();
    }

    function weekNumber() {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(
        date.getDate() + 3 - ((date.getDay() + 6) % 7)
      );
      const week1 = new Date(date.getFullYear(), 0, 4);
      return (
        1 +
        Math.round(
          ((date.getTime() - week1.getTime()) / 86400000 -
            3 +
            ((week1.getDay() + 6) % 7)) /
            7
        )
      );
    }

    function getConfig() {
      // unchanged from your version (color + themes logic)
      // (you can paste your existing getConfig body here)
    }

    function showerror(err, ctx, radius) {
      console.error("ANALOG-CLOCK Error: " + err.message);
      const stackTraceArr = formatStackTrace(err.stack);
      console.info(stackTraceArr[1] || "");
      const img = new Image();
      img.src =
        "https://cdn.jsdelivr.net/gh/tomasrudh/analogclock/Images/errorsign.png";
      img.onload = function () {
        ctx.drawImage(img, -radius, -radius, radius / 4, radius / 4);
      };
    }
  }

  setConfig(config) {
    this.config = config;
  }

  getCardSize() {
    return 3;
  }
}

if (!customElements.get("analog-clock")) {
  customElements.define("analog-clock", AnalogClock);
}
