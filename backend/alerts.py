import requests
import json
import logging

logging.basicConfig(level=logging.INFO)

def dispatch_emergency_alert(webhook_url: str, alert_data: dict) -> bool:
    """
    Dispatches automated webhook payloads to Slack, Discord, or custom emergency response 
    endpoints when outbreak R0 or ICU strain thresholds are breached.
    """
    if not webhook_url:
        return False

    formatted_payload = {
        "text": (
            f"🚨 *AEGIS EMERGENCY AMR ESCALATION ALERT* 🚨\n"
            f"*Pathogen Species:* `{alert_data.get('pathogen_name', 'Unknown')}`\n"
            f"*Resistance Gene:* `{alert_data.get('amr_gene', 'Unknown')}`\n"
            f"*Location:* {alert_data.get('hospital_or_site', 'Target Site')}\n"
            f"*Basic Reproduction Number (R0):* `{alert_data.get('r0', 'N/A')}`\n"
            f"*ICU Saturation:* `{alert_data.get('icu_pct', 0)}%`\n"
            f"*Recommended Isolation Boundary:* `{alert_data.get('radius_m', 500)}m`"
        ),
        "attachments": [
            {
                "color": "#dc143c",
                "fields": [
                    {"title": "Latitude", "value": str(alert_data.get("latitude")), "short": True},
                    {"title": "Longitude", "value": str(alert_data.get("longitude")), "short": True},
                    {"title": "E-Value", "value": str(alert_data.get("e_value")), "short": True},
                    {"title": "Bit Score", "value": str(alert_data.get("bit_score")), "short": True}
                ]
            }
        ]
    }

    try:
        res = requests.post(webhook_url, json=formatted_payload, headers={"Content-Type": "application/json"}, timeout=5)
        logging.info(f"Alert Webhook Status: {res.status_code}")
        return res.status_code in [200, 201, 202]
    except Exception as e:
        logging.error(f"Failed to deliver alert webhook: {e}")
        return False