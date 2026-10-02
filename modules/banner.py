"""Startup banner."""

import os
import platform

from colorama import Fore, Style

_CLEAR_COMMAND = "cls" if platform.system() == "Windows" else "clear"


def banner():
    os.system(_CLEAR_COMMAND)
    print(Fore.LIGHTWHITE_EX + ' (               )   (       *                (                     )       (')
    print(Fore.LIGHTWHITE_EX + ' )\\ )  *   )  ( /(   )\\ )  (  `           (   )\\ )       (       ( /(       )\\ )')
    print(Fore.LIGHTWHITE_EX + '(()/(` )  /(  )\\()) (()/(  )\\))(        ( )\\ (()/( (     )\\      )\\()) (   (()/( ')
    print(Fore.LIGHTWHITE_EX + '/(_))( )(_))((_)\\   /(_)_)()\\       ___  )((_) /(_)))\\ ((((_)(  |((_)\\  )\\   /(_)) ')
    print(Fore.CYAN + ' (_)) (_(_())   ((_) (_))  (_()((_)|___|((_)_ (_)) ((_) )\\ _ )\\ |_ ((_)((_) (_)) ')
    print(Fore.CYAN + '/ __||_   _|  / _ \\ | _ \\ |  \\/  |      | _ )| _ \\| __|(_)_\\(_)| |/ / | __|| _ \\ ')
    print(Fore.CYAN + "\\__ \\  | |   | (_) ||   / | |\\/| |      | _ \\|   /| _|  / _ \\    ' <  | _| |   / ")
    print(Fore.CYAN + '|___/  |_|    \\___/ |_|_\\ |_|  |_|      |___/|_|_\\|___|/_/ \\_\\  _|\\_\\ |___||_|_\\')
    print(Style.RESET_ALL)


if __name__ == "__main__":
    banner()
