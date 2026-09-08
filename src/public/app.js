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

const modelContext = document.modelContext;
if (modelContext?.registerTool) {
  const lifecycle = new AbortController();
  Promise.resolve(modelContext.registerTool({
    name: "start_resource_creation",
    title: "開始新增檔案庫內容",
    description: "在目前頁面開啟上傳檔案或發表連結表單；此操作只準備表單，不會送出內容。",
    inputSchema: {
      type: "object",
      properties: { kind: { type: "string", enum: ["file", "link"] } },
      required: ["kind"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (!input || !["file", "link"].includes(input.kind)) throw new Error("kind 必須是 file 或 link");
      const panel = document.querySelector(input.kind === "file" ? ".action-card.mint" : ".action-card.peach");
      if (!panel) throw new Error("目前頁面沒有新增表單");
      panel.open = true;
      panel.scrollIntoView({ behavior: "smooth", block: "start" });
      return { status: "ready", kind: input.kind };
    },
  }, { signal: lifecycle.signal })).catch(() => {});
}
