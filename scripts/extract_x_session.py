"""
extract_x_session.py
One-time helper — grabs your X auth cookies from your real Edge profile
and saves them as SOMA's .x_session.json so it can post autonomously.

REQUIREMENTS:
  1. Close ALL Edge windows before running this.
  2. Run:  python scripts/extract_x_session.py
"""
import asyncio, json, subprocess, time, os, sys
from pathlib import Path
from playwright.async_api import async_playwright

EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
]
EDGE_PROFILE = str(Path(os.environ['LOCALAPPDATA']) / 'Microsoft' / 'Edge' / 'User Data')
DEBUG_PORT   = 9223   # use 9223 to avoid clashing with any other debug sessions
OUTPUT_FILE  = str(Path(__file__).parent.parent / 'appendages' / 'provenance' / 'browser' / '.x_session.json')


def find_edge():
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    return None


async def main():
    edge_exe = find_edge()
    if not edge_exe:
        print("ERROR: Could not find msedge.exe — is Edge installed?")
        sys.exit(1)

    print(f"Using Edge: {edge_exe}")
    print(f"Profile:    {EDGE_PROFILE}")
    print(f"Output:     {OUTPUT_FILE}")
    print()

    # Kill any existing Edge processes so we can launch with the debug port
    print("Killing existing Edge processes...")
    subprocess.run(['taskkill', '/F', '/IM', 'msedge.exe', '/T'],
                   capture_output=True)
    subprocess.run(['taskkill', '/F', '/IM', 'msedgewebview2.exe', '/T'],
                   capture_output=True)
    time.sleep(3)

    print("Launching Edge with your real profile + remote debugging...")
    proc = subprocess.Popen([
        edge_exe,
        f'--remote-debugging-port={DEBUG_PORT}',
        f'--user-data-dir={EDGE_PROFILE}',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions-except=',
        'https://x.com/home',
    ])

    print("Waiting for Edge to start...")
    time.sleep(8)

    async with async_playwright() as pw:
        try:
            # Use 127.0.0.1 explicitly — localhost resolves to ::1 on Windows (IPv6)
            # but Edge binds to 127.0.0.1 (IPv4), causing ECONNREFUSED
            browser = await pw.chromium.connect_over_cdp(f'http://127.0.0.1:{DEBUG_PORT}')
        except Exception as e:
            print(f"\nERROR: Could not connect to Edge debugging port: {e}")
            print("Make sure ALL Edge windows were closed before running this script.")
            proc.terminate()
            sys.exit(1)

        contexts = browser.contexts
        if not contexts:
            print("ERROR: No browser context found")
            proc.terminate()
            sys.exit(1)

        ctx = contexts[0]

        # Find or navigate to x.com
        x_page = None
        for p in ctx.pages:
            if 'x.com' in p.url or 'twitter.com' in p.url:
                x_page = p
                break

        if not x_page:
            x_page = await ctx.new_page()
            await x_page.goto('https://x.com/home', wait_until='domcontentloaded', timeout=30_000)

        await x_page.wait_for_load_state('domcontentloaded')
        time.sleep(3)

        current_url = x_page.url
        print(f"Current URL: {current_url}")

        if 'login' in current_url.lower() or 'flow' in current_url.lower():
            print("\nX is showing the login page — you are not logged in on this Edge profile.")
            print("Log in now in the browser window that opened, then come back here.")
            input("Press Enter once you are on the X home feed...")
            time.sleep(2)

        # Export full storage state (cookies + localStorage)
        state = await ctx.storage_state()

        x_cookies = [
            c for c in state.get('cookies', [])
            if 'x.com' in c.get('domain', '') or 'twitter.com' in c.get('domain', '')
        ]

        if not x_cookies:
            print("\nWARNING: No X cookies found — make sure you are logged in on x.com in that window.")
            await browser.close()
            proc.terminate()
            sys.exit(1)

        os.makedirs(os.path.dirname(OUTPUT_FILE), exist_ok=True)
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(state, f)
        print(f"\nSaved {len(x_cookies)} X cookies to:\n   {OUTPUT_FILE}")

        # ── LinkedIn: go to login page and wait for user to sign in ─────────────
        print("\nOpening LinkedIn login page in the browser window...")
        li_page = await ctx.new_page()
        await li_page.goto('https://www.linkedin.com/login', wait_until='domcontentloaded', timeout=30_000)
        time.sleep(2)

        print("\n>>> The browser window now has a LinkedIn login tab.")
        print(">>> Log into LinkedIn there, then come back here and press Enter.")
        input("Press Enter once you can see your LinkedIn feed... ")
        time.sleep(3)

        # Re-grab storage state after LinkedIn login
        state = await ctx.storage_state()

        li_cookies = [c for c in state.get('cookies', []) if 'linkedin' in c.get('domain', '').lower()]
        print(f"\nLinkedIn cookies found: {len(li_cookies)}")
        for c in li_cookies:
            print(f"  {c['name']} | domain={c['domain']} | value={c['value'][:30]}...")

        li_at_cookie = next(
            (c for c in state.get('cookies', [])
             if c['name'] == 'li_at' and 'linkedin' in c.get('domain', '').lower()),
            None
        )
        jsessionid_cookie = next(
            (c for c in state.get('cookies', [])
             if c['name'] == 'JSESSIONID' and 'linkedin' in c.get('domain', '').lower()),
            None
        )

        if li_at_cookie and jsessionid_cookie:
            soma_dir = Path(__file__).parent.parent / 'SOMA'
            soma_dir.mkdir(exist_ok=True)
            li_session = {
                'liAt':       li_at_cookie['value'],
                'jsessionid': jsessionid_cookie['value'],
            }
            li_out = str(soma_dir / '.linkedin-api-session.json')
            with open(li_out, 'w') as f:
                json.dump(li_session, f)
            print(f"Saved LinkedIn session (li_at + JSESSIONID) to:\n   {li_out}")
        else:
            print("\nNOTE: LinkedIn li_at still not found — LinkedIn posting will not work.")
            print("      Try logging into LinkedIn manually in Edge, then re-run this script.")

        print("\nSOMA can now post to X (and LinkedIn if logged in) autonomously.")
        await browser.close()

    proc.terminate()


if __name__ == '__main__':
    asyncio.run(main())
