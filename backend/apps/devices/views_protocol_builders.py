"""Options blocks the device parses line-by-line; missing keys break it."""

TRANS_FLAG = (
    "TransFlag=TransData AttLog\tOpLog\tAttPhoto\tEnrollUser\tChgUser\tEnrollFP"
    "\tChgFP\tFPImag\tFACE\tUserPic\tBioPhoto"
)


def _tz_hour(device) -> int:
    return device.timezone_min // 60 if abs(device.timezone_min) >= 60 else device.timezone_min


def build_registered_response(device, registry_code: str) -> str:
    """Newer push firmware (pushver 3.x / PushOptionsFlag=1) expects this
    'registry=ok' block; RequestDelay drives its getrequest poll cadence."""
    return "\n".join([
        "registry=ok",
        f"RegistryCode={registry_code}",
        f"ATTLOGStamp={device.attlog_stamp}",
        f"OPERLOGStamp={device.operlog_stamp}",
        f"ATTPHOTOStamp={device.photo_stamp}",
        "BIODATAStamp=None",
        "ERRORLOGStamp=None",
        "ErrorDelay=30",
        "RequestDelay=10",
        "TransTimes=00:00;14:00",
        "TransInterval=1",
        TRANS_FLAG,
        f"TimeZone={_tz_hour(device)}",
        f"Realtime={1 if device.real_time else 0}",
        "Encrypt=None",
        "ServerVer=2.4.2 1",
        "PushProtVer=2.4.1",
        f"SessionID={registry_code}",
        "TimeoutSec=60",
        "SupportPing=1",
    ])


def build_init_response(device) -> str:
    """Legacy firmware options block ('GET OPTION FROM')."""
    return "\n".join([
        f"GET OPTION FROM: {device.serial_number}",
        f"ATTLOGStamp={device.attlog_stamp}",
        f"OPERLOGStamp={device.operlog_stamp}",
        f"ATTPHOTOStamp={device.photo_stamp}",
        "BIODATAStamp=None",
        "ERRORLOGStamp=None",
        "ErrorDelay=30",
        "Delay=10",
        "TransTimes=00:00;14:00",
        "TransInterval=1",
        TRANS_FLAG,
        f"TimeZone={_tz_hour(device)}",
        f"Realtime={1 if device.real_time else 0}",
        "Encrypt=None",
        "ServerVer=2.4.2 1",
        "PushProtVer=2.2.14",
        "SupportPing=1",
    ])
