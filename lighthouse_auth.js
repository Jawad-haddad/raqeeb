const puppeteer = require('puppeteer');
const { execSync } = require('child_process');

(async () => {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();

  console.log('Step 1: Navigating to App...');
  await page.goto('https://gradversion3.netlify.app/', { waitUntil: 'networkidle2' });

  console.log('Step 2: Entering Credentials...');
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', process.env.EMAIL);
  await page.type('input[type="password"]', process.env.PASSWORD);

  console.log('Step 3: Clicking Sign In...');
  await page.click('.login-button');

  console.log('Waiting for Dashboard to load...');
  try {
    await page.waitForSelector('.dashboard-sidebar', { timeout: 15000 });
    console.log('Dashboard detected! Starting audit...');
  } catch (e) {
    console.log('Timeout waiting for dashboard selector. Forcing a 5s sleep...');
    await new Promise(r => setTimeout(r, 5000));
  }

  const endpoint = browser.wsEndpoint();
  const port = new URL(endpoint).port;
  console.log(`Step 4: Connecting Lighthouse to port ${port}...`);

  try {
    execSync(`npx lighthouse https://gradversion3.netlify.app/ --port=${port} --output html --output-path ./lh-report.html --chrome-flags="--headless"`, { stdio: 'inherit' });
    console.log('Step 5: Audit complete. Report generated.');
  } catch (err) {
    console.error('Lighthouse execution failed:', err.message);
  }

  await browser.close();
})();
