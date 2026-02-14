# Regex suggestions (v3 heuristic)

These are not auto-applied. They’re meant to guide updates in your moment/intent detection.

## Stakeholder sign-off / procurement
Suggested patterns to catch:
- signs off / approval / approve / approved
- CFO / finance / budget owner
- procurement / legal / security review / DPA / MSA

Example regex:
```
/\b(signs?\s+off|approv(e|al)|cfo|finance|budget\s+owner|procurement|legal|msa|dpa|security\s+review)\b/i
```

## Style constraints
Catch modifiers and treat them as style constraints, not 'unknown moment':
```
/\b(short\s+version|tl;dr|keep\s+it\s+short|non-technical|explain\s+like\s+i\'?m\s+five|answer\s+today|deciding\s+this\s+week)\b/i
```
