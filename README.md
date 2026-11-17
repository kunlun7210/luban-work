# 万能工具箱

[打开万能工具箱](https://kunlun7210.github.io/luban-work/)。

首页按分类展示 92 项工具，保留鲁班工作台的原网址。其中 88 项在站内运行，智能去水印、智能裁剪截图、智能隐私拼图和足迹地图继续从各自的项目地址打开。

计算、密码、OCR、媒体转换和编辑等功能在浏览器中处理输入。短网址通过 is.gd 生成，翻译通过 MyMemory，参考汇率来自 Frankfurter，以图搜番使用 trace.moe。页面会标注输入发往哪个服务。ICP备案和测速使用官方查询入口；Bilibili 接口无法直接查询时，可以从用户粘贴的网页元数据中提取封面。

## 开发

- `index.html` 与 `assets/` 提供首页、工具目录和浏览器端基础工具。
- `tool/` 包含工具入口和各功能独立页面。
- `assets/extra/` 中的模块提供各独立网页工具，浏览器端依赖及授权信息在 `assets/vendor-extra/`。
- `vip/` 提供浏览器端图像处理、OCR、表格识别的实现与依赖。MediaPipe 模型在首次使用时从 Google 官方地址下载。
- `scripts/refresh-bing.py` 更新官方壁纸清单，Pages 工作流会定期刷新。
- 旧的 `tools/` 二维码、条形码、订阅、密码和 PDF 地址仍可访问。

用静态 HTTP 服务打开仓库，或访问 GitHub Pages。浏览器端二维码读取使用 ZXing，PDF 工具使用 qpdf WASM，依赖许可证随相应资源提供。运行 `npm ci && npm test` 可以验证旧工具兼容入口所用的编码和转换模块。
