import { test, expect } from '@playwright/test';

test.describe('Digital Twin & Emergency Alert Center', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate as officer
    await page.goto('/login');
    await page.waitForLoadState('domcontentloaded');

    const emailInput = page.locator('input[type="email"], input[name="email"], #email');
    if (await emailInput.count() > 0 && await emailInput.isVisible()) {
      await emailInput.fill('admin@ein.gov.in');
      await page.locator('input[type="password"], input[name="password"], #password').fill('Gov@12345');
      await page.locator('button[type="submit"], button:has-text("SIGN IN WITH CREDENTIALS")').first().click();
      await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  });

  test('Digital Twin: no fullscreen option on left rail, arrow is down chevron', async ({ page }) => {
    await page.goto('/digital-twin');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);

    // 1. By default forecast rail is collapsed with down arrow
    const toggleBtn = page.locator('[data-testid="forecast-toggle-btn"]');
    await expect(toggleBtn).toBeVisible();

    // Verify ChevronDown is inside the collapsed toggle button
    const downChevron = toggleBtn.locator('svg.lucide-chevron-down');
    await expect(downChevron).toBeVisible();

    // Verify fullscreen button does NOT exist next to collapsed toggle
    const collapsedFullscreenBtn = page.locator('[data-testid="flood-intelligence-collapsed-fullscreen-btn"]');
    await expect(collapsedFullscreenBtn).toHaveCount(0);

    // Save screenshot of collapsed down arrow state
    await page.screenshot({
      path: '/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06/dt_down_arrow_collapsed.png',
    });

    // 2. Click toggle button to expand rail
    await toggleBtn.click();
    await page.waitForTimeout(500);

    // In expanded rail header: Flood Intelligence has NO fullscreen button
    const headerFullscreenBtn = page.locator('[data-testid="flood-intelligence-fullscreen-btn"]');
    await expect(headerFullscreenBtn).toHaveCount(0);

    // Verify Flood Intelligence title is displayed cleanly
    await expect(page.locator('text=Flood Intelligence').first()).toBeVisible();

    // Verify Weather Forecast, Flood Forecast, and Landslide Forecast cards are visible
    await expect(page.locator('text=Weather Forecast').first()).toBeVisible();
    await expect(page.locator('text=Forecast Heatmap').first()).toBeVisible();
    await expect(page.locator('text=Landslide Forecast').first()).toBeVisible();

    // Save screenshot of expanded rail
    await page.screenshot({
      path: '/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06/dt_expanded_no_fullscreen.png',
    });
  });

  test('Users Page: Monitored Area question, Evacuation Map Picker, and mob_alerts DB recording', async ({ page }) => {
    await page.goto('/users');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2000);

    // 1. Check tabs: Mobile Citizens, Dispatched Alerts (mob_alerts DB), Departmental Officers
    const mobUsersTab = page.locator('[data-testid="tab-mob-users-btn"]');
    const mobAlertsTab = page.locator('[data-testid="tab-mob-alerts-btn"]');
    const officersTab = page.locator('[data-testid="tab-officers-btn"]');

    await expect(mobUsersTab).toBeVisible();
    await expect(mobAlertsTab).toBeVisible();
    await expect(officersTab).toBeVisible();

    // 2. Open Emergency Alert & Evacuation Dispatch Center Modal
    const openBroadcastBtn = page.locator('[data-testid="open-broadcast-alert-btn"]');
    await expect(openBroadcastBtn).toBeVisible();
    await openBroadcastBtn.click();
    await page.waitForTimeout(500);

    // 3. Verify Monitored Zone option is selected by default
    const monitoredZoneBtn = page.locator('[data-testid="target-monitored-zone-btn"]');
    await expect(monitoredZoneBtn).toBeVisible();

    // Verify "Which Monitored Area?" selector is displayed
    await expect(page.locator('text=Which Monitored Area?')).toBeVisible();
    const areaDropdown = page.locator('[data-testid="select-monitored-area-dropdown"]');
    await expect(areaDropdown).toBeVisible();

    // Select "Aliyar River Corridor & Dam Sector"
    await areaDropdown.selectOption('Aliyar River Corridor & Dam Sector');
    await page.waitForTimeout(300);

    // 4. Verify Channels: Call, Message, In-App Notification checkboxes
    await expect(page.locator('[data-testid="channel-call-checkbox"]')).toBeChecked();
    await expect(page.locator('[data-testid="channel-message-checkbox"]')).toBeChecked();
    await expect(page.locator('[data-testid="channel-inapp-checkbox"]')).toBeChecked();

    // 5. Verify Evacuation Point section with Interactive Leaflet Map Picker
    await expect(page.locator('[data-testid="include-evacuation-checkbox"]')).toBeChecked();
    const leafletMap = page.locator('[data-testid="evacuation-leaflet-map"]');
    await expect(leafletMap).toBeVisible();

    // Click on a preset shelter button or on the map to choose evacuation point
    const alphaPreset = page.locator('[data-testid="preset-shelter-pollachi-high-ground-relief-camp-alpha"]');
    if (await alphaPreset.isVisible()) {
      await alphaPreset.click();
    } else {
      // Click somewhere on the leaflet map container
      await leafletMap.click({ position: { x: 100, y: 100 } });
    }
    await page.waitForTimeout(300);

    // Verify Shelter inputs populated
    const latInput = page.locator('[data-testid="evac-lat-input"]');
    const lngInput = page.locator('[data-testid="evac-lng-input"]');
    const elevInput = page.locator('[data-testid="evac-elev-input"]');
    const shelterNameInput = page.locator('[data-testid="evac-shelter-input"]');

    expect(Number(await latInput.inputValue())).toBeGreaterThan(0);
    expect(Number(await lngInput.inputValue())).toBeGreaterThan(0);
    expect(Number(await elevInput.inputValue())).toBeGreaterThan(0);
    expect((await shelterNameInput.inputValue()).length).toBeGreaterThan(0);

    // Save screenshot of the interactive Emergency Alert modal with Map Picker and Monitored Area selection
    await page.screenshot({
      path: '/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06/users_modal_map_picker_monitored_area.png',
    });

    // 6. Click Dispatch Emergency Alert
    const dispatchBtn = page.locator('[data-testid="dispatch-emergency-alert-btn"]');
    await expect(dispatchBtn).toBeEnabled();
    await dispatchBtn.click();

    // Wait for dispatch mutation and modal to close
    await page.waitForTimeout(2000);

    // 7. Check Dispatched Alerts tab (mob_alerts DB)
    await mobAlertsTab.click();
    await page.waitForTimeout(1000);

    const mobAlertsCard = page.locator('[data-testid="mob-alerts-card"]');
    await expect(mobAlertsCard).toBeVisible();

    // Verify mob-alerts-table contains rows
    const mobAlertsTable = page.locator('[data-testid="mob-alerts-table"]');
    await expect(mobAlertsTable).toBeVisible();
    await expect(mobAlertsTable.locator('tbody tr')).not.toHaveCount(0);

    // Save screenshot of mob_alerts table
    await page.screenshot({
      path: '/Users/vijay/.gemini/antigravity/brain/230933b3-7d16-4574-99a8-be5f96f74a06/mob_alerts_table_verified.png',
    });
  });
});
