const puppeteer = require('puppeteer-core');
const { execSync } = require('child_process');

(async () => {
  const browser = await puppeteer.launch({
    executablePath: '/usr/bin/google-chrome',
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log('Step 1: Logging in...');
  await page.goto('https://gradversion3.netlify.app/', { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', process.env.EMAIL);
  await page.type('input[type="password"]', process.env.PASSWORD);
  await page.click('.login-button');

  console.log('Step 2: Waiting for Dashboard...');
  await page.waitForSelector('.dashboard-sidebar', { timeout: 15000 });

  const port = new URL(browser.wsEndpoint()).port;
  console.log(`Step 3: Running Lighthouse in FRAGILE mode on port ${port}...`);

  try {
    execSync(`npx lighthouse https://gradversion3.netlify.app/dashboard --port=${port} --output html --output-path ./lh-report.html --chrome-flags="--headless" --disable-storage-reset --only-categories=performance,accessibility`, { stdio: 'inherit' });
    console.log('Step 4: Success!');
  } catch (err) {
    console.error('Audit failed:', err.message);
  }

  await browser.close();
})();
