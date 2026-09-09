document.querySelectorAll("[data-access-select]").forEach((select) => {
  const picker = select.parentElement.querySelector("[data-selected-members]");
  const sync = () => { picker.hidden = select.value !== "selected"; };
  select.addEventListener("change", sync);
  sync();
});

const radioGroup = document.querySelectorAll("[data-access-radio]");
if (radioGroup.length) {
  const picker = document.querySelector("[data-selected-members]");
  const sync = () => {
    const selected = document.querySelector("[data-access-radio]:checked");
    picker.hidden = selected?.value !== "selected";
  };
  radioGroup.forEach((radio) => radio.addEventListener("change", sync));
  sync();
}

document.querySelectorAll('input[type="file"]').forEach((input) => {
  input.addEventListener("change", () => {
    const label = input.closest("label");
    const output = label?.querySelector("[data-file-name]");
    if (output) output.textContent = input.files?.[0]?.name || "尚未選擇檔案";
  });
});

document.querySelectorAll("form[data-confirm]").forEach(form => {
  form.addEventListener("submit",event => {
    if (!window.confirm(form.dataset.confirm)) event.preventDefault();
  });
});

document.querySelector("[data-copy-share]")?.addEventListener("click", async () => {
  const field = document.querySelector("[data-share-url]");
  const status = document.querySelector("[data-copy-status]");
  try {
    await navigator.clipboard.writeText(field.value);
    status.textContent = "連結已複製。對方仍需登入學校帳號才能開啟。";
  } catch {
    field.select();
    status.textContent = "請複製上方已選取的網址。";
  }
});

const createDialog = document.querySelector("[data-create-dialog]");
const createButton = document.querySelector("[data-create-open]");
function openCreateDialog(kind) {
  if (!createDialog) return false;
  if (!createDialog.open) createDialog.showModal();
  createButton?.setAttribute("aria-expanded","true");
  if (kind) {
    createDialog.querySelectorAll("[data-create-kind]").forEach(panel => { panel.open = panel.dataset.createKind === kind; });
    createDialog.querySelector(`[data-create-kind="${kind}"] summary`)?.focus();
  }
  return true;
}
createButton?.addEventListener("click",() => openCreateDialog());
document.querySelector("[data-create-close]")?.addEventListener("click",() => createDialog.close());
createDialog?.addEventListener("click",event => {
  if (event.target === createDialog) createDialog.close();
});
createDialog?.addEventListener("close",() => createButton?.setAttribute("aria-expanded","false"));

const userSearch = document.querySelector("[data-user-search]");
const userResults = document.querySelector("[data-user-results]");
if (userSearch && userResults) {
  let timer;
  let request;
  const hideResults = () => {
    userResults.hidden = true;
    userSearch.setAttribute("aria-expanded","false");
  };
  const showUsers = users => {
    userResults.replaceChildren();
    if (!users.length) {
      const empty = document.createElement("span");
      empty.className = "user-result-empty";
      empty.textContent = "找不到已使用 Google 登入且已啟用的成員";
      userResults.append(empty);
    } else {
      users.forEach(user => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "user-result";
        button.setAttribute("role","option");
        const name = document.createElement("strong");
        const email = document.createElement("small");
        name.textContent = user.displayName;
        email.textContent = user.email;
        button.append(name,email);
        button.addEventListener("click",() => {
          userSearch.value = user.email;
          hideResults();
          userSearch.focus();
        });
        userResults.append(button);
      });
    }
    userResults.hidden = false;
    userSearch.setAttribute("aria-expanded","true");
  };
  userSearch.addEventListener("input",() => {
    clearTimeout(timer);
    request?.abort();
    const query = userSearch.value.trim();
    if (query.length < 2) return hideResults();
    timer = setTimeout(async () => {
      request = new AbortController();
      try {
        const response = await fetch(`${userSearch.dataset.searchUrl}?q=${encodeURIComponent(query)}`,{ headers:{ Accept:"application/json" },signal:request.signal });
        if (!response.ok) throw new Error();
        showUsers((await response.json()).users || []);
      } catch (error) {
        if (error.name !== "AbortError") hideResults();
      }
    },180);
  });
  userSearch.addEventListener("keydown",event => {
    if (event.key === "Escape") hideResults();
    if (event.key === "ArrowDown" && !userResults.hidden) {
      event.preventDefault();
      userResults.querySelector("button")?.focus();
    }
  });
  document.addEventListener("click",event => {
    if (!event.target.closest(".user-combobox")) hideResults();
  });
}

const modelContext = document.modelContext;
if (modelContext?.registerTool && createDialog) {
  const lifecycle = new AbortController();
  Promise.resolve(modelContext.registerTool({
    name: "start_resource_creation",
    title: "開始新增檔案庫內容",
    description: "在目前頁面開啟上傳檔案、發表連結或建立資料夾表單；此操作只準備表單，不會送出內容。",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["file", "link", "folder"] } },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input || !["file", "link", "folder"].includes(input.kind)) throw new Error("kind 必須是 file、link 或 folder");
      if (!openCreateDialog(input.kind)) throw new Error("目前頁面沒有新增表單");
      return { status: "ready", kind: input.kind };
    },
  }, { signal: lifecycle.signal })).catch(() => {});
}
