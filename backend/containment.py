from typing import Dict, Any

def simulate_containment(
    r0_initial: float,
    infectious_peak: int,
    population: int = 150000,
    total_icu_beds: int = 120,
    total_ventilators: int = 40,
    lockdown_factor: float = 0.0,  # 0.0 (None) to 0.8 (Strict Lockdown)
    base_radius_km: float = 0.5
) -> Dict[str, Any]:
    """
    Simulates regional clinical capacity strain (ICU saturation, ventilator load)
    and calculates dynamic physical quarantine perimeter expansion based on Effective R (Reff).
    """
    # Effective Reproduction Number (Reff) under containment measures
    reff = round(max(0.35, r0_initial * (1.0 - lockdown_factor * 0.75)), 2)
    
    # Calculate severe and critical clinical cases
    strain_modifier = reff / max(0.1, r0_initial)
    icu_demand = int(round(infectious_peak * 0.12 * strain_modifier))
    ventilator_demand = int(round(icu_demand * 0.35))
    
    icu_saturation = round(min(100.0, (icu_demand / max(1, total_icu_beds)) * 100.0), 1)
    vent_saturation = round(min(100.0, (ventilator_demand / max(1, total_ventilators)) * 100.0), 1)
    
    # Dynamic perimeter expansion (meters)
    recommended_radius_m = int(round(base_radius_km * 1000.0 * (1.0 + (reff - 1.0) * 0.45)))
    recommended_radius_m = max(250, min(5000, recommended_radius_m))
    
    if icu_saturation >= 90.0:
        risk_level = "CRITICAL OVERLOAD"
    elif icu_saturation >= 65.0:
        risk_level = "ELEVATED STRAIN"
    else:
        risk_level = "STABLE CONTAINMENT"
        
    return {
        "effective_r0": reff,
        "icu_demand": icu_demand,
        "total_icu_beds": total_icu_beds,
        "icu_saturation_pct": icu_saturation,
        "ventilator_demand": ventilator_demand,
        "total_ventilators": total_ventilators,
        "ventilator_saturation_pct": vent_saturation,
        "recommended_quarantine_radius_m": recommended_radius_m,
        "risk_level": risk_level
    }