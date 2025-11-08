// content.js
console.log("🧩 content.js 已加载");

(async function () {
  // 避免重复注入
  if (window.__zhiyunInjected) {
    console.log("⚠️ inject.js 已存在，跳过注入。");
    return;
  }
  window.__zhiyunInjected = true;

  /**
   * 安全注入脚本文件（通过 src 引用而非内联）
   * @param {string} path - 扩展内的文件路径
   * @returns {Promise<void>}
   */
  function injectScriptSrc(path) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL(path);
      script.type = "text/javascript";
      script.onload = () => {
        script.remove();
        resolve();
      };
      script.onerror = (e) => {
        console.error(`❌ 加载脚本失败：${path}`, e);
        script.remove();
        reject(e);
      };
      (document.head || document.documentElement).appendChild(script);
    });
  }

  try {
    // 先注入依赖库，再注入主逻辑
    await injectScriptSrc("libs/jspdf.min.js");
    await injectScriptSrc("libs/jszip.min.js");
    await injectScriptSrc("inject.js");

    console.log("✅ 页面主世界脚本已安全注入");
  } catch (e) {
    console.error("❌ 注入脚本失败：", e);
  }

  // ================== 通信桥：popup <-> content <-> page ==================

  // 处理 popup 的导出请求
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg?.action === "startExport") {
      console.log("📩 收到 popup 导出指令：", msg);
      window.postMessage(
        {
          __zhiyun_event: "call-start",
          type: msg.type || "pdf",
        },
        "*"
      );
      sendResponse({ ok: true });
    }
  });

  // 监听来自页面主世界的通知（如导出完成）
  window.addEventListener("message", (ev) => {
    if (ev.data?.__zhiyun_event === "export-finished") {
      console.log("✅ 页面导出完成：", ev.data);
      // 转发给 background（可选）
      chrome.runtime.sendMessage({
        action: "notifyDone",
        info: ev.data,
      });
    }
  });

  // =============== 处理 inject.js 发来的 fetchProxy 请求（转给 background） ===============
  window.addEventListener("message", async (ev) => {
    const d = ev.data;
    if (d?.__zhiyun_event === "fetchProxy" && d.url && d.reqId) {
      try {
        console.log("🌐 收到 fetchProxy 请求（转发到 background）：", d.url);

        chrome.runtime.sendMessage(
          {
            action: "fetchProxyRequest",
            url: d.url,
            method: d.method || "GET",
            headers: d.headers || undefined,
            body: d.body || undefined,
          },
          (resp) => {
            if (!resp) {
              window.postMessage({
                __zhiyun_event: "fetchProxyResponse",
                reqId: d.reqId,
                resp: { ok: false, error: "no response from background" },
              }, "*");
              console.warn("⚠️ background 没有返回响应（可能被屏蔽）");
              return;
            }
            // 将 background 的 resp 直接回传给页面（inject.js 会使用 resp.json）
            window.postMessage({
              __zhiyun_event: "fetchProxyResponse",
              reqId: d.reqId,
              resp,
            }, "*");

            console.log("✅ fetchProxy 响应已从 background 返回并转发到页面：", d.url);
          }
        );
      } catch (err) {
        console.error("❌ fetchProxy 转发失败：", err);
        window.postMessage({
          __zhiyun_event: "fetchProxyResponse",
          reqId: d.reqId,
          resp: { ok: false, error: err.message },
        }, "*");
      }
    }
  });

  // =============== 处理 inject.js 请求本地字体（needFont） ===============
  window.addEventListener("message", async (ev) => {
    const d = ev.data;
    if (d?.__zhiyun_event === "needFont" && d.reqId) {
      try {
        const fontUrl = chrome.runtime.getURL("assets/simhei.txt");
        const resp = await fetch(fontUrl);
        const text = await resp.text();
        // 已经是 base64 内容（如果是 ttf 的 base64 txt），直接回传
        window.postMessage({
          __zhiyun_event: "needFontResponse",
          reqId: d.reqId,
          base64: text,
        }, "*");
        console.log("✅ 已返回字体 base64 给页面");
      } catch (err) {
        console.error("❌ 读取字体失败：", err);
        window.postMessage({
          __zhiyun_event: "needFontResponse",
          reqId: d.reqId,
          error: err.message,
        }, "*");
      }
    }
  });

})();
