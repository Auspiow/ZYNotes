console.log("content.js 已注入");

(function () {
  async function main() {
  const pageHasExportFn = (() => {
    try { return typeof window.startZhiyunExport === "function"; } catch (e) { return false; }
  })();

  if (window.__zhiyunHooked && pageHasExportFn) {
    console.log("已注入监听且页面上下文已有导出函数，无需重复。");
    return;
  }
  window.__zhiyunHooked = true;

  if (typeof window.jsPDF === "undefined" && typeof window.jspdf === "undefined") {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = chrome.runtime.getURL("libs/jspdf.min.js");
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    console.log("✅ jspdf.min.js 本地脚本加载完毕");
  }
  const { jsPDF } = window.jspdf || window;

  function getClassID(name, url = location.href) {
    try {
      const u = new URL(url);
      let value = u.searchParams.get(name);
      if (value) return value;
      const hash = u.hash || "";
      if (hash.includes("?")) {
        const params = new URLSearchParams(hash.split("?")[1]);
        return params.get(name);
      }
      return null;
    } catch (e) {
      return null;
    }
  }

  async function TryUrl(urls) {
    for (const url of urls) {
      try {
        const resp = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: "fetchProxy", url },
            (response) => resolve(response)
          );
        });

        if (resp.ok) {
          console.log(`✅ 成功使用接口: ${url}`);
          return { url, data: resp.json };
        } else {
          console.warn(`⚠️ 请求失败: ${url}`, resp.error);
        }
      } catch (err) {
        console.warn(`❌ 请求失败: ${url}`, err);
      }
    }
    throw new Error("两个接口都请求失败");
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = url;
    });
  }

  async function isSameImage(url1, url2, threshold = 0.9) {
    try {
      const [img1, img2] = await Promise.all([loadImage(url1), loadImage(url2)]);
      const size = 32;
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      canvas.width = size;
      canvas.height = size;

      ctx.drawImage(img1, 0, 0, size, size);
      const data1 = ctx.getImageData(0, 0, size, size).data;
      ctx.drawImage(img2, 0, 0, size, size);
      const data2 = ctx.getImageData(0, 0, size, size).data;

      let same = 0;
      for (let i = 0; i < data1.length; i += 4) {
        const diff = Math.abs(data1[i] - data2[i])
          + Math.abs(data1[i + 1] - data2[i + 1])
          + Math.abs(data1[i + 2] - data2[i + 2]);
        if (diff < 30) same++;
      }
      const similarity = same / (data1.length / 4);
      return similarity > threshold;
    } catch (e) {
      console.warn("图片比对失败：", e);
      return false;
    }
  }

  let fontLoaded = false;
  async function loadChineseFont(pdf) {
    if (fontLoaded) return "SimHei";
    const fontUrl = chrome.runtime.getURL("assets/simhei.txt");
    const base64 = await fetch(fontUrl).then(res => res.text());
    pdf.addFileToVFS("simhei.ttf", base64);
    pdf.addFont("simhei.ttf", "SimHei", "normal");
    fontLoaded = true;
    return "SimHei";
  }

  function cleanText(text, mode = "mild") {
    if (!text) return "";

    let t = String(text).trim();

    t = t.replace(/\u00A0/g, " ").replace(/\s+/g, " ").trim();
    if (/^[\s\p{P}\p{S}]+$/u.test(t)) return "";

    const fillers = [
      "嗯","嗯嗯","嗯嗯嗯","啊","呃","哦","唉","哈","哎","额","诶","欸","唔",
      "这个","那个","然后","就是","其实","好像","对吧","你知道","对不对",
      "我觉得","可能吧","吧","嘛","啦","呢","哈哈","嘿嘿","emm","emmm"
    ];
    const fillerPattern = new RegExp(
      "(^|[\\s，。,.!?;:—\\-\\(\\)\\[\\]\"'“”‘’])(" +
        fillers.map(s => s.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|") +
      ")(?=$|[\\s，。,.!?;:—\\-\\(\\)\\[\\]\"'“”‘’])",
      "gi"
    );
    t = t.replace(fillerPattern, " ");

    const replacements = {
      "ppt": "幻灯片",
      "PPT": "幻灯片",
      "视频片": "视频",
      "音频片": "音频",
      "的 的": "的",
      "就是说": "",
      "然后我们": "我们",
      "我们要说": "我们要学",
      "非常非常": "非常"
    };
    for (const [wrong, right] of Object.entries(replacements)) {
      t = t.replace(new RegExp(wrong, "gi"), right);
    }

    t = t
      .replace(/([好对是行有没要看说])\1{1,}/g, "$1")
      .replace(/([啊哦嗯呃哈欸呀])\1{1,}/g, "$1")
      .replace(/[，,]{2,}/g, "，")
      .replace(/[。\.]{2,}/g, "。")
      .replace(/[！!]{2,}/g, "！")
      .replace(/[？\?]{2,}/g, "？")
      .replace(/\s+/g, " ")
      .trim();

    if (/^[\s0-9０-９\.,，。]+$/.test(t)) return "";

    const chineseCount = (t.match(/[\u4e00-\u9fa5]/g) || []).length;
    const englishCount = (t.match(/[A-Za-z]/g) || []).length;
    const total = chineseCount + englishCount;

    if (total > 0) {
      const chineseRatio = chineseCount / total;
      const englishRatio = englishCount / total;

      if (chineseRatio > 0.95) {
        t = t.replace(/[A-Za-z0-9@#%&_\-+=\/\\]+/g, "").trim();
      }
      else if (englishRatio > 0.95) {
        t = t.replace(/[\u4e00-\u9fa5]/g, "").trim();
      }
      else if (Math.abs(chineseRatio - englishRatio) < 0.3) {
        if (t.length < 10) return "";
      }
    }

    const plain = t.replace(/^[\u2000-\u206F\u2E00-\u2E7F\p{P}\p{S}\s]+|[\u2000-\u206F\u2E00-\u2E7F\p{P}\p{S}\s]+$/gu,"").trim();
    if ([...plain].length <= 1) return "";
    if (/^[\u4e00-\u9fff]([。\.，,]?){0,1}$/.test(t)) return "";

    if (!/[。！？!?]$/.test(t)) {
      t = t + "。";
    }

    t = t.replace(/\s+/g, " ").trim();
    if (t.length <= 2) return "";

    return t;
  }

  async function makePdf(result) {
    const pdf = new jsPDF({ unit: "px", format: "a4" });
    const fontName = await loadChineseFont(pdf);
    pdf.setFont(fontName);

    for (let i = 0; i < result.length; i++) {
      if (i > 0) pdf.addPage();

      const page = result[i];
      const imgUrl = page.img.replace(/^http:/, "https:");
      const img = await loadImage(imgUrl);

      pdf.setFontSize(12);
      const header = `Page ${i + 1} (${page.current_time})`;
      pdf.text(header, 20, 20);

      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const imgData = canvas.toDataURL("image/jpeg");
      pdf.addImage(imgData, "JPEG", 20, 40, 400, 225);

      pdf.setFontSize(10);
      const text = (page.texts || []).join("\n") || "（暂无文字）";
      const lines = pdf.splitTextToSize(text, 400);
      let y = 280;
      for (const line of lines) {
        if (y > 570) {
          pdf.addPage();
          y = 40;
        }
        pdf.text(line, 20, y);
        y += 12;
      }

      pdf.setFontSize(9);
      pdf.text(`Page ${i + 1} / ${result.length}`, 400, 560);
    }
    const courseTitle =
      document.querySelector(".title")?.textContent?.trim() ||
      document.querySelector(".course_name")?.textContent?.trim() || "未知课程";
    const subTitle = document.querySelector(".sub")?.textContent?.trim() || "";
    const fullTitle = subTitle ? `${courseTitle}-${subTitle}` : courseTitle;
    const safeName = `${fullTitle}.pdf`.replace(/[\/\\:*?"<>|]/g, "_");
    pdf.save(safeName);
  }

  async function makeMarkdown(result) {
    if (typeof window.JSZip === "undefined") {
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = chrome.runtime.getURL("libs/jszip.min.js");
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
      console.log("✅ jszip.min.js 本地脚本加载完毕");
    }

    const zip = new JSZip();
    const imgFolder = zip.folder("images");

    const courseTitle =
      document.querySelector(".title")?.textContent?.trim() ||
      document.querySelector(".course_name")?.textContent?.trim() ||
      "未知课程";
    const subTitle = document.querySelector(".sub")?.textContent?.trim() || "";
    const fullTitle = subTitle ? `${courseTitle}-${subTitle}` : courseTitle;
    const safeName = fullTitle.replace(/[\/\\:*?"<>|]/g, "_");

    const headerMd = `# ${fullTitle}\n\n> 导出时间：${new Date().toLocaleString("zh-CN")}\n\n`;

    const mdParts = new Array(result.length);

    await Promise.all(
      result.map(async (page, i) => {
        try {
          const time = page.current_time || "未知时间";
          const imgUrl = page.img?.replace(/^http:/, "https:");
          const imgResp = await fetch(imgUrl);
          const blob = await imgResp.blob();
          const arrayBuffer = await blob.arrayBuffer();

          const imgName = `page_${String(i + 1).padStart(2, "0")}.jpg`;
          imgFolder.file(imgName, arrayBuffer);

          const text = (page.texts || []).join("\n").trim();

          let part = `---\n\n## 🖼️ 第 ${i + 1} 页\n\n`;
          part += `**时间：** ${time}\n\n`;
          part += `![第 ${i + 1} 页](images/${imgName})\n\n`;
          part += text ? `**讲述内容：**\n\n${text}\n\n` : `（暂无字幕）\n\n`;

          mdParts[i] = part;
        } catch (err) {
          mdParts[i] = `## 第 ${i + 1} 页\n\n⚠️ 加载失败：${err.message}\n\n`;
        }
      })
    );

    const finalMd = headerMd + mdParts.join("");
    zip.file(`${safeName}.md`, finalMd); // .md 在根目录

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(zipBlob);
    a.download = `${safeName}.zip`;
    a.click();

    setTimeout(() => URL.revokeObjectURL(a.href), 3000);

    console.log(`✅ Markdown + 图片 ZIP 导出完成：${safeName}.zip`);
  }


  async function tryFetchSearchPptOnce() {
    const courseId = getClassID("course_id");
    const subId = getClassID("sub_id");
    if (!courseId || !subId) {
      console.log("❌ 页面 URL 中未找到 course_id 或 sub_id，跳过主动请求。");
      return;
    }

    const pptBaseUrls = [
      `https://interactivemeta.cmc.zju.edu.cn/pptnoteapi/v1/schedule/search-ppt?course_id=${courseId}&sub_id=${subId}`,
      `https://classroom.zju.edu.cn/pptnote/v1/schedule/search-ppt?course_id=${courseId}&sub_id=${subId}`
    ];

    const transUrls = [
      `https://interactivemeta.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id=${subId}&format=json`,
      `https://yjapi.cmc.zju.edu.cn/courseapi/v3/web-socket/search-trans-result?sub_id=${subId}&format=json`
    ];

    try {
      const pptList = [];
      let page = 1;

      while (true) {
        const pptUrls = pptBaseUrls.map(
          base => `${base}&page=${page}&per_page=100`
        );
        const { data: pptDataRaw } = await TryUrl(pptUrls);

        if (!pptDataRaw?.list?.length) {
          console.log(`📭 第 ${page} 页无数据，停止抓取。`);
          break;
        }
        for (const item of pptDataRaw.list) { 
          try { 
            const content = JSON.parse(item.content); 
            if (content.pptimgurl) { 
              pptList.push({ time: item.created_sec, current_time: item.create_time, img: content.pptimgurl }); 
            } 
          } catch (e) { console.warn("⚠️ 解析 pptcontent 失败:", item); } }
        console.log(`📄 已获取第 ${page} 页，共 ${pptDataRaw.list.length} 条`);
        page++;
      }

      console.log("拿到 ppt 页数", pptList.length);

      const { data: transDataRaw } = await TryUrl(transUrls);
      const transData = [];

      for (const transItem of transDataRaw.list || []) {
        const allContent = transItem.all_content || [];
        for (const content of allContent) {
          const cleaned = cleanText(content.Text);
          if (cleaned) {
            transData.push({
              time: content.BeginSec,
              text: cleaned,
            });
          }
        }
      }

      pptList.sort((a, b) => a.time - b.time);
      transData.sort((a, b) => a.time - b.time);

      const mergedPpt = [];

      for (const slide of pptList) {
        if (mergedPpt.length === 0) {
          mergedPpt.push({ img: slide.img, time: slide.time, current_time: slide.current_time });
          continue;
        }

        const last = mergedPpt[mergedPpt.length - 1];
        const lastUrl = last.img.replace(/^http:/, "https:");
        const currentUrl = slide.img.replace(/^http:/, "https:");
        if (lastUrl === currentUrl) {
          continue;
        }

        try {
          const same = await isSameImage(lastUrl, currentUrl);
          if (same) continue;
        } catch (e) {}

        mergedPpt.push({ img: slide.img, time: slide.time, current_time: slide.current_time });
      }

      console.log("✅ 合并后 PPT 数量:", mergedPpt.length);

      const result = mergedPpt.map((slide, idx) => {
        const nextStart = mergedPpt[idx + 1]?.time ?? Infinity;
        const texts = transData
          .filter(t => t.time >= slide.time && t.time < nextStart)
          .map(t => t.text);
        return {
          img: slide.img,
          texts,
          current_time: slide.current_time,
        };
      });

      console.log("✅ 数据整理完毕，共", result.length, "页");
      return result;

    } catch (err) {
      console.error("❌ 请求 search-ppt 失败:", err);
    }
  }
  console.log("🎉 智云课堂 search-ppt 工具已注入，可等待 popup 触发");

  window.startZhiyunExport = async function (type = "pdf") {
    console.log(`📥 收到 popup 调用，开始生成 ${type.toUpperCase()}...`);

    try {
      const result = await tryFetchSearchPptOnce();

      if (!result || !Array.isArray(result)) {
        alert("❌ 导出失败：未能获取课程数据");
        return;
      }

      if (type === "markdown") {
        await makeMarkdown(result);
        alert("✅ Markdown 导出完成！");
      } else {
        await makePdf(result);
        alert("✅ PDF 导出完成！");
      }

      console.log(`✅ ${type.toUpperCase()} 导出完成`);
    } catch (err) {
      console.error("❌ 导出失败：", err);
      alert("❌ 导出失败，请检查控制台日志。");
    }
  };

    try {
    const fn = window.startZhiyunExport;
    if (typeof fn === "function") {
      const script = document.createElement("script");
      script.type = "text/javascript";
      script.textContent = `window.startZhiyunExport = ${fn.toString()};\nconsole.log("✅ startZhiyunExport 已注入到页面主世界");`;
      (document.documentElement || document.head || document.body).appendChild(script);
      script.remove();
    } else {
      console.warn("无法注入到页面：window.startZhiyunExport 在 content script 中未定义");
    }
  } catch (e) {
    console.error("注入 startZhiyunExport 到页面主世界失败：", e);
  }
}
  main().catch(err => console.error("content.js 初始化失败：", err));
})();