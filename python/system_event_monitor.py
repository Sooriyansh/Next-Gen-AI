import argparse
import ctypes
import os
import platform
import socket
import sys
import time
from datetime import timezone

import requests

try:
    import psutil
    import win32evtlog
    import win32evtlogutil
except ImportError as error:
    print(
        "Missing dependency. Run `npm run setup:python` or install pywin32 and psutil first.",
        file=sys.stderr,
    )
    raise SystemExit(str(error))


SYSTEM_EVENT_MAP = {
    6005: {
        "event": "Startup",
        "meaning": "Laptop ON hua",
        "providers": {"EventLog"},
    },
    6006: {
        "event": "Shutdown",
        "meaning": "Laptop OFF hua",
        "providers": {"EventLog"},
    },
    6008: {
        "event": "Unexpected Shutdown",
        "meaning": "Laptop unexpectedly OFF hua",
        "providers": {"EventLog"},
    },
    1074: {
        "event": "Shutdown",
        "meaning": "Shutdown ya restart initiate hua",
        "providers": {"USER32"},
    },
    42: {
        "event": "Sleep",
        "meaning": "Sleep mode",
        "providers": {"Microsoft-Windows-Kernel-Power"},
    },
    1: {
        "event": "Wakeup",
        "meaning": "Sleep se wapas ON",
        "providers": {"Microsoft-Windows-Power-Troubleshooter"},
    },
}

SECURITY_EVENT_MAP = {
    4800: {
        "event": "Lock",
        "meaning": "Screen lock",
        "providers": {"Microsoft-Windows-Security-Auditing"},
    },
    4801: {
        "event": "Unlock",
        "meaning": "Screen unlock",
        "providers": {"Microsoft-Windows-Security-Auditing"},
    },
}

LOG_CONFIG = {
    "System": SYSTEM_EVENT_MAP,
    "Security": SECURITY_EVENT_MAP,
}


def event_id(raw_event_id):
    return int(raw_event_id) & 0xFFFF


def iso_datetime(value):
    if hasattr(value, "astimezone"):
        return value.astimezone(timezone.utc).isoformat()
    return str(value)


def format_message(log_name, event):
    try:
        return win32evtlogutil.SafeFormatMessage(event, log_name).strip()
    except Exception:
        return ""


def rule_matches_provider(rule, provider):
    providers = rule.get("providers")
    return not providers or provider in providers


def classify_event(log_name, current_event_id, message):
    rule = LOG_CONFIG[log_name][current_event_id]
    event_name = rule["event"]
    meaning = rule["meaning"]

    if current_event_id == 1074:
        lowered = message.lower()
        if "restart" in lowered or "reboot" in lowered:
            return "Restart", "Restart hua"
        return "Shutdown", "Laptop OFF hua"

    return event_name, meaning


def read_windows_events(max_records):
    computer_name = socket.gethostname()
    collected = []

    for log_name, event_map in LOG_CONFIG.items():
        try:
            handle = win32evtlog.OpenEventLog(None, log_name)
        except Exception as error:
            print(f"Could not open {log_name} log: {error}", file=sys.stderr)
            continue

        flags = win32evtlog.EVENTLOG_BACKWARDS_READ | win32evtlog.EVENTLOG_SEQUENTIAL_READ
        records_seen = 0

        try:
            while records_seen < max_records:
                events = win32evtlog.ReadEventLog(handle, flags, 0)
                if not events:
                    break

                for event in events:
                    records_seen += 1
                    current_event_id = event_id(event.EventID)

                    provider = str(event.SourceName or "")

                    if current_event_id not in event_map:
                        if records_seen >= max_records:
                            break
                        continue

                    if not rule_matches_provider(event_map[current_event_id], provider):
                        if records_seen >= max_records:
                            break
                        continue

                    message = format_message(log_name, event)
                    event_name, meaning = classify_event(log_name, current_event_id, message)
                    record_number = int(event.RecordNumber)

                    collected.append(
                        {
                            "event": event_name,
                            "meaning": meaning,
                            "occurredAt": iso_datetime(event.TimeGenerated),
                            "eventId": current_event_id,
                            "sourceLog": log_name,
                            "provider": provider,
                            "recordNumber": record_number,
                            "computer": str(event.ComputerName or computer_name),
                            "user": os.getenv("EMPLOYEE_EMAIL") or os.getenv("USERNAME", ""),
                            "message": message[:2000],
                            "externalId": f"{log_name}:{record_number}:{current_event_id}",
                        }
                    )

                    if records_seen >= max_records:
                        break
        finally:
            win32evtlog.CloseEventLog(handle)

    return collected


def add_boot_event(events):
    boot_time = getattr(psutil, "boot_time", lambda: None)()
    if not boot_time:
        return events

    occurred_at = time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(boot_time))
    events.append(
        {
            "event": "Startup",
            "meaning": "Laptop ON hua",
            "occurredAt": occurred_at,
            "eventId": 0,
            "sourceLog": "psutil",
            "provider": "psutil.boot_time",
            "recordNumber": None,
            "computer": socket.gethostname(),
            "user": os.getenv("USERNAME", ""),
            "message": "Current boot time detected by psutil.",
            "externalId": f"psutil:boot:{int(boot_time)}",
        }
    )
    return events


class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [("cbSize", ctypes.c_uint), ("dwTime", ctypes.c_uint)]


def get_idle_seconds():
    last_input = LASTINPUTINFO()
    last_input.cbSize = ctypes.sizeof(last_input)
    if not ctypes.windll.user32.GetLastInputInfo(ctypes.byref(last_input)):
        return 0
    millis = ctypes.windll.kernel32.GetTickCount() - last_input.dwTime
    return max(0, int(millis / 1000))


def add_activity_state_event(events, idle_threshold_seconds):
    idle_seconds = get_idle_seconds()
    now = time.time()
    event_name = "Idle Time" if idle_seconds >= idle_threshold_seconds else "Active Usage Time"
    events.append(
        {
            "event": event_name,
            "meaning": "No OS input detected" if event_name == "Idle Time" else "Keyboard or mouse activity detected by OS",
            "occurredAt": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now)),
            "eventId": 9302 if event_name == "Idle Time" else 9301,
            "sourceLog": "Windows Idle Detection",
            "provider": "GetLastInputInfo",
            "recordNumber": None,
            "computer": socket.gethostname(),
            "user": os.getenv("EMPLOYEE_EMAIL") or os.getenv("USERNAME", ""),
            "message": f"OS idle seconds: {idle_seconds}",
            "externalId": f"idle:{socket.gethostname()}:{event_name}:{int(now // 30)}",
        }
    )
    return events


def add_device_health_events(events):
    now = time.time()
    events.append(
        {
            "event": "Device Online",
            "meaning": "Device collector heartbeat",
            "occurredAt": time.strftime("%Y-%m-%dT%H:%M:%S%z", time.localtime(now)),
            "eventId": 9303,
            "sourceLog": "Device Collector",
            "provider": "Heartbeat",
            "recordNumber": None,
            "computer": socket.gethostname(),
            "user": os.getenv("EMPLOYEE_EMAIL") or os.getenv("USERNAME", ""),
            "message": "Device collector is online.",
            "externalId": f"heartbeat:{socket.gethostname()}:{int(now // 60)}",
        }
    )
    return events


def post_events(api_url, events, collector_token):
    if not events:
        return {"received": 0, "inserted": 0}

    headers = {}
    if collector_token:
        headers["X-Collector-Token"] = collector_token

    response = requests.post(api_url, json={"events": events}, headers=headers, timeout=15)
    response.raise_for_status()
    return response.json()


def run_once(api_url, max_records, collector_token, idle_threshold_seconds):
    events = add_device_health_events(add_activity_state_event(add_boot_event(read_windows_events(max_records)), idle_threshold_seconds))
    result = post_events(api_url, events, collector_token)
    print(
        f"Sent {result.get('received', 0)} event(s), inserted {result.get('inserted', 0)} new event(s).",
        flush=True,
    )


def main():
    parser = argparse.ArgumentParser(description="Monitor Windows system events and send them to the dashboard API.")
    parser.add_argument(
        "--api-url",
        default=os.getenv("SYSTEM_EVENTS_API_URL", "http://localhost:8080/api/system-events/ingest"),
        help="Node API endpoint that stores system events.",
    )
    parser.add_argument("--interval", type=int, default=60, help="Polling interval in seconds.")
    parser.add_argument("--max-records", type=int, default=500, help="Recent records to scan per Windows log.")
    parser.add_argument("--collector-token", default=os.getenv("SYSTEM_COLLECTOR_TOKEN", ""), help="Shared token for the system event collector.")
    parser.add_argument("--employee-email", default=os.getenv("EMPLOYEE_EMAIL", ""), help="Employee email to scope collector events.")
    parser.add_argument("--idle-threshold", type=int, default=300, help="Seconds without OS input before idle is reported.")
    parser.add_argument("--once", action="store_true", help="Collect events once and exit.")
    args = parser.parse_args()

    if platform.system() != "Windows":
        raise SystemExit("System event monitoring is available only on Windows.")

    if args.employee_email:
        os.environ["EMPLOYEE_EMAIL"] = args.employee_email

    if args.once:
        run_once(args.api_url, args.max_records, args.collector_token, args.idle_threshold)
        return

    print("Windows system event monitor started. Press Ctrl+C to stop.", flush=True)
    while True:
        try:
            run_once(args.api_url, args.max_records, args.collector_token, args.idle_threshold)
        except KeyboardInterrupt:
            raise
        except Exception as error:
            print(f"Monitor error: {error}", file=sys.stderr, flush=True)
        time.sleep(max(args.interval, 5))


if __name__ == "__main__":
    main()
