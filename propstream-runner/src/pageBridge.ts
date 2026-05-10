export const PAGE_BRIDGE_SOURCE = `
(() => {
  function text(el) {
    return (el?.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function escapeRegex(value) {
    return String(value || "").replace(/[|\\\\{}()[\\]^$+*?.]/g, "\\\\$&");
  }

  function isVisible(el) {
    if (!el || !(el instanceof Element)) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function queryAll(selectors, root = document) {
    for (const selector of selectors) {
      const found = Array.from(root.querySelectorAll(selector));
      if (found.length) return found;
    }
    return [];
  }

  function matchesByText(nodes, regex) {
    return nodes.find((node) => regex.test(text(node))) || null;
  }

  function buttons(root = document) {
    return Array.from(
      root.querySelectorAll(
        "button, a, [role='button'], div[class*='dropdownToggleBtn'], div[class*='actionWrapper'], div[class*='buttonSave'], label[class*='checkboxContainer']",
      ),
    );
  }

  function findButtonByText(regex, root = document) {
    return matchesByText(buttons(root), regex);
  }

  function clickElement(el) {
    if (!el || typeof el.click !== "function") return false;
    el.click();
    return true;
  }

  function setElementValue(el, value) {
    if (!el || !("value" in el)) return false;
    const prototype =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
    if (descriptor && typeof descriptor.set === "function") {
      descriptor.set.call(el, String(value));
    } else {
      el.value = String(value);
    }
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  function visibleInputs(root = document) {
    return Array.from(root.querySelectorAll("input, textarea, [contenteditable='true']")).filter(isVisible);
  }

  function checkboxState(el) {
    if (!el) return null;
    if (el instanceof HTMLInputElement && el.type === "checkbox") return Boolean(el.checked);
    const ariaChecked = el.getAttribute?.("aria-checked");
    if (ariaChecked === "true") return true;
    if (ariaChecked === "false") return false;
    return null;
  }

  function nearestBulkPanel() {
    const actionsButton = findButtonByText(/^actions$/i) || findButtonByText(/actions/i);
    if (!actionsButton) return null;
    let node = actionsButton;
    for (let depth = 0; node && depth < 10; depth += 1) {
      const nodeText = text(node);
      const hasPropertiesText = /properties|selected/i.test(nodeText);
      const hasCheckbox = visibleCheckboxes(node).length > 0 ||
        node.querySelectorAll("input[type='checkbox'], [role='checkbox']").length > 0;
      const hasActions = Boolean(findButtonByText(/^actions$/i, node) || findButtonByText(/actions/i, node));
      if (hasPropertiesText && hasCheckbox && hasActions) return node;
      node = node.parentElement;
    }
    return actionsButton.parentElement || document.body;
  }

  function visibleCheckboxes(root = document) {
    return Array.from(root.querySelectorAll("input[type='checkbox'], [role='checkbox']")).filter(isVisible);
  }

  function propertyItems(root = document) {
    const exact = Array.from(root.querySelectorAll("[id^='property-']")).filter(isVisible);
    if (exact.length) return exact;
    return Array.from(root.querySelectorAll("div[class*='__item']")).filter(isVisible);
  }

  function semanticCandidates() {
    return buttons()
      .filter(isVisible)
      .map((node) => ({
        text: text(node).slice(0, 120),
        className: typeof node.className === "string" ? node.className.slice(0, 120) : "",
        href: node instanceof HTMLAnchorElement ? node.href : "",
      }))
      .slice(0, 40);
  }

  function detectPagePhase() {
    const pathname = window.location.pathname;
    if (/account|billing|usage/i.test(pathname)) return "usage";
    if (/property\\/group/i.test(pathname)) return "saved_list";
    if (/search\\//i.test(pathname) && pathname !== "/search") return "property_detail";
    if (/search/i.test(pathname)) return "search";
    return "unknown";
  }

  function resultCountText() {
    const candidates = Array.from(document.querySelectorAll("[class*='caption'], h1, h2, h3"));
    const match = candidates.find((node) => /properties|results/i.test(text(node)));
    return match ? text(match) : null;
  }

  function visibleRegions() {
    const regions = Array.from(document.querySelectorAll("main, section, aside, [role='dialog']"))
      .filter(isVisible)
      .map((node) => {
        const label = node.getAttribute("aria-label") || node.getAttribute("role") || node.tagName.toLowerCase();
        const snippet = text(node).slice(0, 80);
        return [label, snippet].filter(Boolean).join(": ");
      });
    return Array.from(new Set(regions)).slice(0, 20);
  }

  function collectVisibleRows(limit = 25) {
    const rows = queryAll([
      "div[class*='__content'] div[class*='__item']",
      "table tbody tr",
      "[role='rowgroup'] [role='row']",
      "[class*='result-row']",
      "[class*='property-row']"
    ]).filter(isVisible);

    return rows.slice(0, limit).map((row, index) => ({
      index,
      text: text(row),
      propertyId: row.getAttribute("data-id") || row.getAttribute("data-property-id") || row.dataset?.id || "",
      hrefs: Array.from(row.querySelectorAll("a[href]")).map((a) => a.href).slice(0, 4),
    }));
  }

  function selectedZip() {
    const input = document.querySelector("input[placeholder*='Zip' i], input[placeholder*='ZIP' i], input[name*='zip' i]");
    return input && "value" in input ? String(input.value || "") : null;
  }

  function selectedListName() {
    const candidates = Array.from(document.querySelectorAll("h1, h2, h3, [class*='title']"));
    const match = candidates.find((node) => /saved|list|properties/i.test(text(node)));
    return match ? text(match) : null;
  }

  function hasCaptcha() {
    return Boolean(document.querySelector("iframe[src*='recaptcha'], [class*='captcha'], [id*='captcha']"));
  }

  function authRequired() {
    if (document.querySelector("input[type='password']")) return true;
    if (/login|sign[\s-]?in/i.test(document.title || "")) return true;
    if (/\/search/i.test(window.location.pathname)) return false;
    const bodyText = document.body?.innerText?.slice(0, 1500) || "";
    const looksLikeLoginForm =
      /username|email address/i.test(bodyText) &&
      /password/i.test(bodyText) &&
      /login|sign in|log in/i.test(bodyText);
    return looksLikeLoginForm;
  }

  window.__PS_RUNNER__ = {
    snapshot() {
      return {
        route: window.location.pathname,
        title: document.title || "",
        page_phase: detectPagePhase(),
        visible_regions: visibleRegions(),
        candidate_actions: semanticCandidates().map((item) => item.text || item.className || item.href).filter(Boolean),
        result_count_text: resultCountText(),
        visible_row_count: collectVisibleRows().length,
        selected_list_name: selectedListName(),
        selected_zip: selectedZip(),
        has_captcha: hasCaptcha(),
        auth_required: authRequired(),
        diagnostics: {
          semantic_candidates: semanticCandidates(),
          route_query: window.location.search,
          row_preview: collectVisibleRows(5),
        },
      };
    },
    collectVisibleRows,
    readResultsHeader: resultCountText,
    openFilters() {
      const button = findButtonByText(/filters/i);
      if (!button) return false;
      button.click();
      return true;
    },
    openActionsMenu() {
      const panel = nearestBulkPanel();
      if (!panel) return false;
      const button =
        findButtonByText(/^actions$/i, panel) ||
        findButtonByText(/actions/i, panel) ||
        panel.querySelector("[class*='dropdownToggleBtn']");
      return clickElement(button);
    },
    openBulkActionByText(label) {
      const regex = new RegExp("^" + escapeRegex(label) + "$", "i");
      const panel = nearestBulkPanel();
      if (!panel) return false;
      const candidate =
        findButtonByText(regex, document) ||
        matchesByText(Array.from(document.querySelectorAll("*")).filter(isVisible), regex) ||
        findButtonByText(regex, panel) ||
        matchesByText(Array.from(panel.querySelectorAll("*")).filter(isVisible), regex);
      return clickElement(candidate);
    },
    setBulkSelection(checked) {
      const panel = nearestBulkPanel();
      if (!panel) return false;
      let checkbox = visibleCheckboxes(panel)[0];
      if (!checkbox) {
        const allCheckboxes = Array.from(panel.querySelectorAll("input[type='checkbox'], [role='checkbox']"));
        checkbox = allCheckboxes[0];
      }
      if (!checkbox) return false;
      const current = checkboxState(checkbox);
      if (current === checked) return true;
      return clickElement(checkbox);
    },
    setInputRange(start, end) {
      const panel = nearestBulkPanel();
      if (!panel) return false;
      const button = findButtonByText(/show property range/i, panel);
      if (!button) return false;
      const scopedInputs = visibleInputs(panel).filter((node) => {
        const placeholder = "placeholder" in node ? String(node.placeholder || "") : "";
        return !/county|city|zip|apn/i.test(placeholder);
      });
      if (scopedInputs.length < 2) return false;
      setElementValue(scopedInputs[0], start);
      setElementValue(scopedInputs[1], end);
      return true;
    },
    showPropertyRange() {
      const panel = nearestBulkPanel();
      if (!panel) return false;
      const button = findButtonByText(/show property range/i, panel);
      return clickElement(button);
    },
    selectResultRowsByRange(start, end) {
      const startIndex = Math.max(Number(start) || 1, 1);
      const endIndex = Math.max(Number(end) || startIndex, startIndex);
      const items = propertyItems(document);
      if (!items.length) return 0;
      let selected = 0;
      for (let index = startIndex - 1; index < Math.min(endIndex, items.length); index += 1) {
        const item = items[index];
        const checkbox =
          item.querySelector("input[type='checkbox']") ||
          item.querySelector("label[class*='checkboxContainer']") ||
          item.querySelector("[role='checkbox']");
        if (!checkbox) continue;
        const current = checkboxState(checkbox);
        if (current === true) {
          selected += 1;
          continue;
        }
        if (clickElement(checkbox)) {
          selected += 1;
        }
      }
      return selected;
    },
    clickSearchHeaderSave() {
      const button =
        document.querySelector("button[class*='buttonSave']") ||
        findButtonByText(/^save$/i, document);
      return clickElement(button);
    },
    findActionButtonByText(regexSource) {
      const button = findButtonByText(new RegExp(regexSource, "i"));
      if (!button) return null;
      return {
        text: text(button),
      };
    },
  };
})();
`;
