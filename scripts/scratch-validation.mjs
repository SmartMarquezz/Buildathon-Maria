import { chromium } from '@playwright/test';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT_DIR = path.join(__dirname, '..', 'screenshots');
const TARGET_ORG = 'buildathon-scratch';

function logStep(name, detail) {
    console.log(`\n=== ${name} ===`);
    console.log(detail);
}

function screenshotPath(name) {
    return path.join(SCREENSHOT_DIR, name);
}

async function capture(page, filename) {
    await page.screenshot({ path: screenshotPath(filename), fullPage: true });
    console.log(`Screenshot saved: screenshots/${filename}`);
}

async function getFrontdoorUrl() {
    const output = execSync(`sf org open --target-org ${TARGET_ORG} --url-only --json`, {
        encoding: 'utf8'
    });
    return JSON.parse(output).result.url;
}

async function getLexBaseUrl() {
    const output = execSync(`sf org display --target-org ${TARGET_ORG} --json`, { encoding: 'utf8' });
    const instanceUrl = JSON.parse(output).result.instanceUrl;
    return instanceUrl.replace('.my.salesforce.com', '.lightning.force.com');
}

async function run() {
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const frontdoorUrl = await getFrontdoorUrl();
    const lexBase = await getLexBaseUrl();

    const browser = await chromium.launch({ headless: false, slowMo: 300 });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        logStep('STEP 1 — Dashboard tab loads', 'Navigate to AI Case Dashboard tab and verify title.');
        await page.goto(frontdoorUrl, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await page.goto(`${lexBase}/lightning/n/AI_Case_Dashboard`, { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        await page.getByText('AI Case Dashboard', { exact: true }).first().waitFor({ state: 'visible' });
        await capture(page, '01-dashboard-loaded.png');

        logStep('STEP 2 — Stats bar renders 3 stat cards', 'Verify three stat cards with numeric values.');
        const statCards = page.locator('.stat-card');
        await statCards.first().waitFor({ state: 'visible' });
        const statCount = await statCards.count();
        if (statCount !== 3) {
            throw new Error(`Expected 3 stat cards, found ${statCount}.`);
        }
        for (let i = 0; i < 3; i += 1) {
            const cardText = await statCards.nth(i).innerText();
            if (!/\d/.test(cardText)) {
                throw new Error(`Stat card ${i + 1} does not contain a numeric value.`);
            }
        }
        await capture(page, '02-stats-bar.png');

        logStep('STEP 3 — Case list shows open cases', 'Wait for spinner to disappear and verify case cards.');
        await page.locator('lightning-spinner').first().waitFor({ state: 'hidden', timeout: 15000 }).catch(() => {});
        const caseCards = page.locator('.case-card');
        await caseCards.first().waitFor({ state: 'visible', timeout: 15000 });
        const caseCount = await caseCards.count();
        if (caseCount < 1) {
            throw new Error('Expected at least one case card.');
        }
        await capture(page, '03-cases-loaded.png');

        logStep('STEP 4 — Clicking a case activates it', 'Select first case and verify active state.');
        const firstCase = caseCards.first();
        await firstCase.click();
        await page.waitForTimeout(1000);
        const activeClass = await firstCase.getAttribute('class');
        if (!activeClass || !activeClass.includes('active')) {
            throw new Error('Selected case card is not active.');
        }
        const generateButton = page.getByRole('button', { name: '✨ Generate AI Summary' });
        await generateButton.waitFor({ state: 'visible' });
        if (await generateButton.isDisabled()) {
            throw new Error('Generate AI Summary button should not be disabled after selecting a case.');
        }
        await capture(page, '04-case-selected.png');

        logStep(
            'STEP 5 — Generate AI Summary returns all 5 sections',
            'Trigger AI summary and verify all result sections render.'
        );
        await generateButton.click();
        await page.locator('.generating-state').waitFor({ state: 'visible', timeout: 10000 });
        await page.locator('.generating-state').waitFor({ state: 'hidden', timeout: 30000 });

        const summaryCard = page.locator('.ai-result-card.summary');
        await summaryCard.waitFor({ state: 'visible' });
        const summaryText = await summaryCard.innerText();
        if (!summaryText.trim()) {
            throw new Error('Summary card is empty.');
        }

        const sentimentPill = page.locator('.sentiment-pill');
        await sentimentPill.waitFor({ state: 'visible' });
        const sentimentText = await sentimentPill.innerText();
        if (!/Frustrated|Neutral|Satisfied/i.test(sentimentText)) {
            throw new Error(`Unexpected sentiment value: ${sentimentText}`);
        }

        await page.locator('.ai-result-card.priority').waitFor({ state: 'visible' });

        const replyBox = page.locator('.reply-box');
        await replyBox.waitFor({ state: 'visible' });
        const replyText = await replyBox.innerText();
        if (!replyText || replyText.trim().length <= 50) {
            throw new Error('Suggested reply is missing or too short.');
        }

        await page.locator('.ai-result-card.nba').waitFor({ state: 'visible' });
        await capture(page, '05-ai-results.png');

        logStep('STEP 6 — Copy reply button shows success toast', 'Click Copy Reply and verify toast.');
        await page.getByRole('button', { name: 'Copy Reply' }).click();
        await page.getByText('Copied!').first().waitFor({ state: 'visible', timeout: 10000 });
        await capture(page, '06-copy-success.png');

        logStep('STEP 7 — Seed data verified via CLI', 'Confirm at least 5 open cases exist in org.');
        const queryOutput = execSync(
            `sf data query --query "SELECT COUNT() FROM Case WHERE Status != 'Closed'" --target-org ${TARGET_ORG} --json`,
            { encoding: 'utf8' }
        );
        const totalSize = JSON.parse(queryOutput).result.totalSize;
        if (totalSize < 5) {
            throw new Error(`Expected at least 5 open cases, found ${totalSize}.`);
        }
        console.log(`Open case count verified: ${totalSize}`);
        await capture(page, '07-data-verified.png');

        console.log('\nAll Playwright validation steps passed.');
        process.exitCode = 0;
    } catch (error) {
        console.error(`\nValidation failed: ${error.message}`);
        process.exitCode = 1;
    } finally {
        await browser.close();
    }
}

run();
