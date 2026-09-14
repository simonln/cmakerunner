# 测试运行指南

## 推荐方式（原生 Node/npm 环境）

```bash
npm test
```

这会：
- 编译 `src/` 和 `test/` 到 `out/`
- 通过 `test/vscode-mock.js` 注入 VS Code mock
- 运行 `out/test` 下自动发现的所有 `*.test.js` 套件（当前 13 个，149 个用例）

如果你是在 WSL 中借用 Windows 的 `node.exe`/`npm`，可能会碰到 `cmd.exe` 对 UNC 工作目录的限制；这种情况下请使用下面的直接入口。

## 覆盖率

```bash
npm run test:coverage
```

编译后通过 c8 运行全部测试套件，并同时输出 `text` 与 `lcov` 覆盖率报告；其中 lcov 明细与 HTML 报告生成在 `coverage/` 下。`coverage/` 已被 `.gitignore` 与 `.vscodeignore` 排除，不会提交到仓库或打包进扩展。

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

这个脚本与 `npm test` 使用同一套 mocked VS Code 环境，并同样自动发现全部套件，适合在已编译完成后快速重跑。

## 测试套件发现

`test/run-unit.js` 与 `test/run-coverage.js` 都通过 `test/test-files.js` 自动发现 `out/test` 下所有 `*.test.js`。因此新增 `test/*.test.ts` 无需手工登记；`preferredOrder` 之外的新文件会被自动追加到列表末尾，并打印提示。

`npm run test:watch` 使用 `out/test/**/*.test.js` glob，同样无需登记。

## 当前状态

- 当前完整套件可在普通 Node 环境下运行，不再要求 Extension Development Host。
- 最近一次已验证结果（2026-09-14）：`npm test` 运行 13 个套件，`149 passing`。

## VS Code 调试扩展

如果要手动调试扩展本身，而不是跑单元测试：

1. 用 VS Code 打开仓库
2. 按 `F5`
3. 在新的 Extension Development Host 窗口里手动操作扩展
