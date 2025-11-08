console.log("popup.js 已加载");

document.addEventListener("DOMContentLoaded", () => {
  const pdfBtn = document.getElementById("exportpdf");
  const mdBtn = document.getElementById("exportmd");

  // 封装一个统一的导出启动函数
  async function startExport(type) {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab || !tab.id) {
        alert("❌ 未检测到活动标签页，请重试。");
        return;
      }

      console.log(`📤 向 content.js 发送导出请求：${type}`);
      await chrome.tabs.sendMessage(tab.id, { action: "startExport", type });

      alert(`✅ 已发送导出指令 (${type})，请在页面等待生成结果。`);
    } catch (err) {
      console.error("❌ 发送导出指令失败：", err);
      alert("⚠️ 无法启动导出，请检查扩展是否已正确加载。");
    }
  }

  pdfBtn.addEventListener("click", () => startExport("pdf"));
  mdBtn.addEventListener("click", () => startExport("markdown"));
});
