const puppeteer = require('puppeteer');
const fs = require('fs');
const { exec } = require('child_process');

(async () => {
  const browser = await puppeteer.launch({ 
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox'] 
  });
  const page = await browser.newPage();

  console.log('Step 1: Navigating to Login...');
  await page.goto('https://gradversion3.netlify.app/', { waitUntil: 'networkidle2' });

  console.log('Step 2: Entering Credentials...');
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', process.env.EMAIL);
  await page.type('input[type="password"]', process.env.PASSWORD);
  
  console.log('Step 3: Clicking Login...');
  await page.click('.login-button');
  
  await new Promise(r => setTimeout(r, 5000)); 

  console.log('Session state captured.');

  const endpoint = browser.wsEndpoint();
  const port = new URL(endpoint).port;
  
  console.log('Step 4: Running Lighthouse on port ${port}...');
  
  const lhCommand = 'npx lighthouse https://gradversion3.netlify.app/ --port=${port} --output html --output-path ./lh-report.html --chrome-flags="--headless"';
  
  exec(lhCommand, async (err, stdout, stderr) => {
    if (err) {
      console.error('Lighthouse Error:', err);
    } else {
      console.log('Lighthouse Output:', stdout);
      console.log('Step 5: Audit complete. Report generated as lh-report.html');
    }
    await browser.close();
  });
})();
