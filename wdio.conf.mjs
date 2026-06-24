// WebdriverIO 配置 —— 直连 tauri-plugin-webdriver 内嵌的 W3C server (127.0.0.1:4445)。
//
// 关键点：插件自己就是 WebDriver server，所以这里不挂任何 service
// (不需要 chromedriver / tauri-driver / selenium-standalone)，
// 只把 hostname/port/path 指向 app 内嵌的 server。
//
// 前置：app 必须已在跑（debug 构建，且 pnpm start 已起在 1420）。
//   见 package.json 的 e2e:* 脚本。
export const config = {
  runner: 'local',

  // —— 直连 app 内嵌 server，而非启动外部 driver ——
  hostname: '127.0.0.1',
  port: 4445,
  path: '/',

  specs: ['./test/specs/**/*.e2e.mjs'],
  exclude: [],
  maxInstances: 1,

  // 插件对 capabilities 不挑，给空对象即可（W3C alwaysMatch:{}）
  capabilities: [{}],

  logLevel: 'warn',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: [
    'spec',
    ['junit', { outputDir: './test/reports', outputFileFormat: (o) => `results-${o.cid}.xml` }],
  ],
  mochaOpts: { ui: 'bdd', timeout: 60000 },

  // 每个 session 开始前等就绪 probe（W1 暴露 data-ready = increment_end + inflight0 + cursor稳）。
  // spec §7 before：轮询某 data-ready 标志，再开 UC。
  before: async function () {
    await browser.waitUntil(
      async () => {
        const ready = await $('[data-ready="true"]');
        return await ready.isExisting();
      },
      { timeout: 20000, timeoutMsg: '就绪 probe 未亮 —— 确认 pnpm start 已在 1420 跑 + W1 probe 已发 im:ready' }
    );
  },
};
