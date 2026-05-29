# 测试运行指南

## 推荐方式（原生 Node/npm 环境）

```bash
npm test
```

这会：
- 编译 `src/` 和 `test/`
- 通过 `test/vscode-mock.js` 注入 VS Code mock
- 运行当前完整测试集

如果你是在 WSL 中借用 Windows 的 `node.exe`/`npm`，可能会碰到 `cmd.exe` 对 UNC 工作目录的限制；这种情况下请使用下面的直接入口。

## 监听模式

```bash
npm run test:watch
```

修改测试前请先单独执行一次 `npm run compile`，监听模式只负责重跑已编译输出。

## 直接运行测试入口（当前环境已验证）

```bash
npm run compile
node test/run-unit.js
```

这个脚本与 `npm test` 使用同一套 mocked VS Code 环境，适合在已编译完成后快速重跑；当前会执行完整套件。

## 当前状态

- 当前完整套件可在普通 Node 环境下运行，不再要求 Extension Development Host。
- 最近一次已验证结果：`142 passing`

## VS Code 调试扩展

如果要手动调试扩展本身，而不是跑单元测试：

1. 用 VS Code 打开仓库
2. 按 `F5`
3. 在新的 Extension Development Host 窗口里手动操作扩展
