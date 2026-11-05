from typing import Dict, List, Any

def calculate_seir_projection(
    population: int = 100000,
    initial_infected: int = 5,
    initial_exposed: int = 15,
    beta: float = 0.48,   # High-risk AMR transmission rate
    sigma: float = 0.20,  # 5-day average incubation rate (1/5)
    gamma: float = 0.10,  # 10-day average recovery rate (1/10)
    days: int = 14
) -> Dict[str, Any]:
    """
    Computes numerical SEIR differential trajectories over specified days.
    Returns daily time-series array and calculated R0 value.
    """
    dt = 0.1  # Time step integration resolution (1/10th day)
    steps_per_day = int(1 / dt)
    
    S = float(population - initial_infected - initial_exposed)
    E = float(initial_exposed)
    I = float(initial_infected)
    R = 0.0
    N = float(population)
    
    projection = []
    
    for day in range(1, days + 1):
        for _ in range(steps_per_day):
            dS = -(beta * S * I) / N
            dE = ((beta * S * I) / N) - (sigma * E)
            dI = (sigma * E) - (gamma * I)
            dR = gamma * I
            
            S += dS * dt
            E += dE * dt
            I += dI * dt
            R += dR * dt
            
        projection.append({
            "day": day,
            "susceptible": int(round(S)),
            "exposed": int(round(E)),
            "infectious": int(round(I)),
            "recovered": int(round(R))
        })
        
    r0 = round(beta / gamma, 2)
    
    return {
        "r0": r0,
        "beta": beta,
        "sigma": sigma,
        "gamma": gamma,
        "projection": projection
    }