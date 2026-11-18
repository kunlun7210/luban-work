# 万能工具箱

[打开万能工具箱](https://kunlun7210.github.io/luban-work/)。

首页按分类展示 92 项工具，保留鲁班工作台的原网址。其中 88 项在站内运行，智能去水印、智能裁剪截图、智能隐私拼图和足迹地图继续从各自的项目地址打开。

计算、密码、OCR、媒体转换和编辑等功能在浏览器中处理输入。短网址通过 is.gd 生成，翻译通过 MyMemory，参考汇率来自 Frankfurter，以图搜番使用 trace.moe。页面会标注输入发往哪个服务。ICP备案和测速使用官方查询入口；Bilibili 接口无法直接查询时，可以从用户粘贴的网页元数据中提取封面。

## 订阅转换

支持粘贴节点链接、Base64 或 Clash YAML，亦可选择本地文件。在 [订阅转换](https://kunlun7210.github.io/luban-work/tool/subscription-converter/) 中筛选节点后，可导出 Mihomo 完整配置或节点列表、小火箭分享链接或 Base64，以及 Surge、Loon、Quantumult X 的节点条目。订阅网址由浏览器向源站读取，受源站跨域设置限制。「我的订阅」可在当前浏览器保存和合并多个订阅。Mihomo 完整配置可选择 Tower 随附的 ACL4SSR 默认、全分组或精简方案，来源与许可见 [ACL4SSR 声明](tool/subscription-converter/ACL4SSR-NOTICE.txt)。格式参考 [Tower](https://github.com/pengchujin/tower)，相关部分适用 [MIT 许可](tool/subscription-converter/TOWER-LICENSE.txt)。

## 开发

- `index.html` 与 `assets/` 提供首页、工具目录和浏览器端基础工具。
- `tool/` 包含工具入口和各功能独立页面。
- `assets/extra/` 中的模块提供各独立网页工具，浏览器端依赖及授权信息在 `assets/vendor-extra/`。
- `vip/` 提供浏览器端图像处理、OCR、表格识别的实现与依赖。MediaPipe 模型在首次使用时从 Google 官方地址下载。
- `scripts/refresh-bing.py` 更新官方壁纸清单，Pages 工作流会定期刷新。
- 旧的 `tools/` 二维码、条形码、订阅、密码和 PDF 地址仍可访问。

用静态 HTTP 服务打开仓库，或访问 GitHub Pages。浏览器端二维码读取使用 ZXing，PDF 工具使用 qpdf WASM，依赖许可证随相应资源提供。运行 `npm ci && npm test` 可以验证旧工具兼容入口所用的编码和转换模块。

## 使用与授权

本项目用于个人学习与研究。项目自有代码未采用开源许可证，著作权由相应权利人保留。未经权利人许可，请勿将项目自有代码用于商业用途或再分发，法律另有规定的除外。

项目使用的第三方代码、模型与素材，其权利归各自权利人所有，使用和分发遵循各自适用的许可条款。
