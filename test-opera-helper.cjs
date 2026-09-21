const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

const OPERA_PATH = "C:\\Users\\Dogan\\AppData\\Local\\Programs\\Opera\\opera.exe";
const TEST_PROFILE = path.join(__dirname, ".opera-test-profile");
const BASE_URL = "http://localhost:4000";

let activeContext = null;
let cleanupRegistered = false;

function rmForce(target) {
  try { fs.rmSync(target, { recursive: true, force: true }); } catch (e) {}
}

// Only removes session/tab restore state of the TEST profile.
// Never touches cookies/localStorage, so auth session is preserved.
function clearTestProfileSessionState() {
  const def = path.join(TEST_PROFILE, "Default");
  const roots = [TEST_PROFILE, def];
  for (const root of roots) {
    for (const name of ["Current Session", "Current Tabs", "Last Session", "Last Tabs"]) {
      rmForce(path.join(root, name));
    }
  }
  rmForce(path.join(def, "Sessions"));
  rmForce(path.join(def, "StatsSessions"));
}

// Kills ONLY opera.exe processes whose command line references the test profile.
// The user's own Opera processes never contain this path, so they are untouched.
function cleanupLeftoverTestOpera() {
  if (process.platform !== "win32") return [];
  const needle = TEST_PROFILE.toLowerCase();
  const script =
    "Get-CimInstance Win32_Process -Filter \"Name='opera.exe'\" | " +
    "Where-Object { $_.CommandLine -and $_.CommandLine.ToLower().Contains('" + needle + "') } | " +
    "ForEach-Object { Write-Output $_.ProcessId }";
  let out = "";
  try {
    out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  } catch (e) {
    return [];
  }
  const pids = out.split(/\r?\n/).map(function(s) { return s.trim(); }).filter(function(s) { return /^\d+$/.test(s); });
  for (const pid of pids) {
    try { execFileSync("taskkill", ["/F", "/T", "/PID", pid], { stdio: "ignore" }); } catch (e) {}
  }
  return pids;
}

function registerCleanup() {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  function emergencyCleanup() {
    try { cleanupLeftoverTestOpera(); } catch (e) {}
  }
  process.on("exit", emergencyCleanup);
  process.on("SIGINT", function() { emergencyCleanup(); process.exit(130); });
  process.on("SIGTERM", function() { emergencyCleanup(); process.exit(143); });
  process.on("uncaughtException", function(err) {
    try { console.error(err && err.stack ? err.stack : err); } catch (e) {}
    emergencyCleanup();
    process.exit(1);
  });
  process.on("unhandledRejection", function(err) {
    try { console.error(err && err.stack ? err.stack : err); } catch (e) {}
    emergencyCleanup();
    process.exit(1);
  });
}

async function launchOperaTestBrowser() {
  registerCleanup();
  cleanupLeftoverTestOpera();
  clearTestProfileSessionState();

  const context = await chromium.launchPersistentContext(TEST_PROFILE, {
    headless: false,
    executablePath: OPERA_PATH,
    viewport: { width: 1440, height: 900 },
    ignoreDefaultArgs: ["--enable-automation"],
    args: [
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-session-crashed-bubble",
      "--hide-crash-restore-bubble",
    ],
  });
  activeContext = context;

  // Guarantee a single tab: close any extra pages restored/opened on launch.
  const pages = context.pages();
  for (let i = 1; i < pages.length; i++) {
    try { await pages[i].close(); } catch (e) {}
  }

  context.on("close", function() {
    if (activeContext === context) activeContext = null;
  });

  return context;
}

async function closeOperaTestBrowser(context) {
  if (!context) return;
  try {
    const pages = context.pages();
    for (const p of pages) { try { await p.close(); } catch (e) {} }
  } catch (e) {}
  try { await context.close(); } catch (e) {}
  if (activeContext === context) activeContext = null;
  cleanupLeftoverTestOpera();
}

async function setupAuth(context) {
  const page = context.pages()[0] || await context.newPage();

  await page.goto(BASE_URL);
  await page.waitForTimeout(2000);

  const alreadyLoggedIn = await page
    .evaluate(function() {
      return localStorage.getItem("dgstok_loggedin") === "true";
    })
    .catch(function() { return false; });

  if (alreadyLoggedIn) {
    return { page: page, token: null, user: null };
  }

  const tokenRes = await fetch(BASE_URL + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@dgstok.com", password: "admin123" }),
  });
  const { token, user } = await tokenRes.json();

  if (!token) {
    return { page: page, token: null, user: null };
  }

  const client = await context.newCDPSession(page);
  await client.send("Network.setCookie", {
    name: "token",
    value: token,
    domain: "localhost",
    path: "/",
    httpOnly: true,
    sameSite: "Lax",
    secure: false,
  });

  await page.goto(BASE_URL + "/login");
  await page.waitForTimeout(1000);
  await page.evaluate(
    function(args) {
      localStorage.setItem("dgstok_loggedin", "true");
      localStorage.setItem("dgstok_role", args.user.role || "ADMIN");
      localStorage.setItem("dgstok_user", JSON.stringify(args.user));
      localStorage.setItem("dgstok_token", args.token);
    },
    { token: token, user: user }
  );
  await page.goto(BASE_URL);
  await page.waitForTimeout(3000);

  return { page: page, token: token, user: user };
}

function createChecker() {
  var PASS = 0;
  var FAIL = 0;
  function check(name, result, detail) {
    if (result) {
      PASS++;
      console.log("  PASS: " + name + (detail ? " - " + detail : ""));
    } else {
      FAIL++;
      console.log("  FAIL: " + name + (detail ? " - " + detail : ""));
    }
  }
  return { check: check, getResults: function() { return { PASS: PASS, FAIL: FAIL }; } };
}

module.exports = {
  OPERA_PATH: OPERA_PATH,
  TEST_PROFILE: TEST_PROFILE,
  BASE_URL: BASE_URL,
  launchOperaTestBrowser: launchOperaTestBrowser,
  closeOperaTestBrowser: closeOperaTestBrowser,
  cleanupLeftoverTestOpera: cleanupLeftoverTestOpera,
  clearTestProfileSessionState: clearTestProfileSessionState,
  setupAuth: setupAuth,
  createChecker: createChecker,
};
