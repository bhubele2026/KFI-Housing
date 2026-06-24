# Stage 2 — Occupant Backfill DRY RUN (read-only, no writes)

_Guards against the 2026-06-23 duplicate-occupant bug: every name is checked against the 130 live occupants before it is ever a create candidate._

- Missing associates in CSV: **102**
- Live occupants compared against: **130**
- Live properties available to route to: **34**

## Disposition
- ✅ **single-property, safe to create** (still needs a vacant bed): **44**
- 🧩 **multi-property cluster** (needs the master tab's per-person unit — don't guess the bed): **33**
- 🏗️ **property not live yet** (seed the property first): **12**
- ⚖️ **blocked on a human decision**: **13**
- ❓ unknown source tab: **0**
- ⚠️ **already in app by name (DUP — skip)**: **0**

### ✅ Single-property — safe to create (assign a vacant bed) (44)
- **InterWire.Rome,NY** → `prop-iwg-bloomfield-st` — 7
    - Anthony Charles
    - Jonathan Cedeno
    - Jose A. Garcia
    - Marcos Garza
    - Santiago Coello
    - Stive Pimentel Diaz
    - Tilford Perkins
- **Landscape.Plymounth, MN** → `prop-park-place-plymouth` — 1
    - Steven Loves
- **P2.P5-Portage,WI** → `prop-1779300519785-1whm` — 22
    - Alberto Lee Monnar
    - Christian Quinones
    - Claudia M Ramirez
    - Cristian A Jackson
    - Dalida M Diaz
    - Daniel Young
    - Dario Munoz
    - Eric A Brunson
    - Ethan Hasty
    - Evian D Napier
    - Felix M. Rivera
    - Jason Allen Mills
    - Javien Robinson
    - Jonathan Isaiah Spears
    - Josue D Martinez Garza
    - Logan J Rogers
    - Noah Vaughn
    - Ryan Thomas
    - Stephen Archambo
    - Sybella Sandoval
    - Trevor Jermaine Horne
    - Zion Glover
- **Shusters.Greenock.** → `prop-shusters-900-seneca-mckeesport` — 5
    - Christian Decutier
    - David D. Navarro
    - Ernesto Garcia
    - Willie Turner
    - Yuniel Perez
- **WILSON - Burnett** → `prop-burnett-menomonie-houses` — 9
    - Alejandro Escamilla
    - Alonzo Jenkins
    - Gilberto Matthew Ramos
    - Juan Tapia
    - Kevin Anthony Tirado
    - Miguel Hernandez
    - Nick Lenardson
    - Ramses Reyna
    - Roberto Alvarado

### 🧩 Cluster — route to a building unit from the master tab first (33)
- **Burnett.Siren.Hinkley.** → `prop-burnett-siren-7666-south-shore / prop-burnett-webster-7112-zielsdorf / prop-burnett-hinckley-7th-st-se` — 14
    - Carlos Sosa
    - Christian Frias
    - Christopher Lee
    - Colby Peters
    - Devin R. Neal
    - Edher Ayala
    - Eric D. Moore
    - Evan Sanders
    - Johnny Cortez
    - Juan Ramon Mirelez
    - Juan Sanchez
    - Rayven Smith
    - Ronald Glen Holmes
    - Steven N. Holliday
- **Delallo.Jeannette,PA** → `prop-delallo-yellow-house / prop-delallo-autozone` — 6
    - Abel Small
    - Cory Brittman
    - Daniel Leos Jr
    - Diron Weaver
    - Jordan Brown
    - Julian Ybarra
- **Schuette.Wausau,WI** → `prop-schuette-1331-s-8th-apt-200 / prop-schuette-1341-s-8th-apt-108` — 6
    - Andrew B Sweet
    - Austin Crawford
    - Eduardo Solano Rios
    - Ethan Long
    - Jacob Slade Brown
    - James W Hart
- **WB Man.Gilman,WI** → `prop-sunset-place-neillsville / prop-hickory-haven-gilman` — 7
    - Abigail Sarmiento
    - Anddy Ramirez Pedraza
    - Erica D. Silverio Reyes
    - Jessica Acevedo
    - Noe Rodriguez
    - Ricardo Herrera
    - Roy Serna

### 🏗️ Property not live — seed it before importing these people (12)
- **Adient** → `Econo Lodge Jefferson City — NOT live (memory: superseded by seed-adient)` — 1
    - Yuniel Perez
- **Greystone** → `Chateau Knoll, Bettendorf IA — NOT live (no matching property)` — 11
    - Aaron Collins
    - Branden Gonzalez
    - Christopher de la Rosa
    - Gabriel Clark
    - Gabriel Shamam
    - Jacob Varney
    - Jacoby Chenevert
    - Jose Angulo
    - Richard M. Anthony
    - Tanner Langford
    - Victor A. Valenzuela

### ⚖️ Blocked on a human decision (13)
- **El Paso, TX** → `prop-bartlett-el-paso — brief decision was HOLD/empty stub; Appendix A lists 4 to import (conflict)` — 4
    - Gerardo Soto
    - Ladontae Brown
    - Ladonte M. Brown
    - Luis Quintero
- **Orgill...Sikeston,MO** → `Beau Chateau Dexter vs TB Rentals Sikeston — open decision #4` — 9
    - Amado Tijerina
    - Bryant Fulmore
    - Eleazar Madrigal
    - Jorge Molina
    - Jose Quintanar
    - Marco Madrigal
    - Marice Chisley
    - Noel Granados
    - Rene Lopez
