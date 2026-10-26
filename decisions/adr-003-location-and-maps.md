# ADR-003 | Location and maps

- **Question:** How is location captured and rendered, and what provides maps?
- **Alternatives:** (a) Area selection with no precise GPS, distance from neighborhood centroid, maps behind a stubbed `MapsProvider` port. (b) Precise browser geolocation. (c) A live maps provider from day one.
- **Decision:** (a).
- **Rationale:** `02` deliberately avoids precise GPS and `12` restricts precise location to consented need. Closes gap G3: distance is measured from the selected neighborhood centroid, and with no neighborhood the 10% weight is redistributed and disclosed. No provider key is enabled until ADR-003 is revisited with the spend cap set.
- **Owner:** Kareem Gad · **Date:** 2026-10-26 · **Status:** Approved
- **Revisit trigger:** Spend cap agreed, or a journey that genuinely requires a rendered map.
