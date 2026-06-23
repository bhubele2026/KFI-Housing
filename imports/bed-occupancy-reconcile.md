# Bed Occupancy Reconciliation

SharePoint Housing Master vs app `/api/occupants`+`/api/beds` vs `/api/roster/active`. Generated 2026-06-17. **App not modified** (read-only reconciliation).

## Source note (important)
- The occupancy grids come from **`Housing Master File 2026.xlsx`** — one block/tab per property — at SharePoint `KFISImplementation > Housing Master File and Leases`, URI `file:///b!D_coNqVzXUW1_0SPJYIgPdH8Rd0kUthHmNa_QbgVRxKUzZMtdHG3TIvxOoJwD3JY/01R4TRPRFXZLYHXVVAOJDIVXMTZSWONE7Q`. (The separate `Housing Lease MASTER.xlsx` is only a vendor/cost/address summary with no person names.)
- That workbook is **hand-maintained**: several blocks are misaligned in export, carry stale/garbled cells, or have grid-vs-roster internal conflicts. Per-property caveats are in each section's row data / notes. The biggest divergences: **The Ridge (2900 New Pinery)** master block is a newer snapshot using different room numbers/people than the app; **Wausau Apt 108** master shows a 6/12/2026 move-in group entirely different from the app's current 3 occupants; **Bloomfield** master grid is mostly blank/misaligned (names recovered, beds not mappable).
- The lease subfolders (Park Place, Bloomfield, Wausau, etc.) contain only corporate lease PDFs naming "KFI Staffing" — no per-bed person grids — so all names here are from the master workbook, not leases.

## Summary
- **masterOccupied**: 140
- **match**: 96
- **name-diff**: 2
- **appMissing**: 42
- **masterMissing**: 23
- **noRosterMatch**: 40

## Greenock Manor – McKeesport, PA
_master beds=28 · app beds=28_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| Apt 45 | 1 | Harold Covington | Harold Covington | OK | HAROLD COVINGTON (2004797) |
| Apt 45 | 2 | Alfonso A. Garcia |  | APP MISSING | NO MATCH |
| Apt 45 | 3 | Ernesto Garcia |  | APP MISSING | NO MATCH |
| Apt 45 | 4 | Akniel A. Garcia |  | APP MISSING | NO MATCH |
| Apt 36 | 1 | Justin Martinez | Justin Martinez | OK | JUSTIN MARTINEZ (2002254) |
| Apt 36 | 2 | Derrick Black | Derrick Black | OK | DERRICK L BLACK (2004750) |
| Apt 48 | 1 | Tony Perry | Tony Perry | OK | TONY A PERRY (2005084) |
| Apt 48 | 2 | Christopher Hill | Christopher Hopson | NAME DIFF | CHRISTOPHER HILL (2004747) |
| Apt 48 | 3 | Tyler Smith | Tyler Smith | OK | TYLER SMITH (2005083) |
| Apt 48 | 4 | Jared Lemert | Jared Lemert | OK | JARED LEMERT (2004749) |
| Apt 49 | 1 | Mandrell Coretz | Mandrell Coretz | OK | NO MATCH |
| Apt 49 | 2 | Joy Doran | Joy Doran | OK | JOY DORAN (2003771) |
| Apt 49 | 3 | David D. Navarro |  | APP MISSING | NO MATCH |
| Apt 49 | 4 | Navarro Gabriel |  | APP MISSING | NO MATCH |
| Apt 32 | 2 | Sam Houston | Sam Houston | OK | SAM D HOUSTON (2004768) |
| Apt 32 | 3 | Christian Decuire | Christian Decuire | OK | CHRISTIAN M DECUIRE (2004767) |
| Apt 42 | 1 | Timothy Rouse | Timothy Rouse | OK | TIMOTHY N ROUSE (2005114) |
| Apt 42 | 2 | Jacob Mullinax | Jacob Mullinax | OK | JACOB MULLINAX (2005115) |
| Apt 42 | 3 | Richard Russell | Richard Russell | OK | RICHARD R RUSSELL (2005113) |
| Apt 52 | 1 | Lucas J Young | Lucas J Young | OK | LUCAS J YOUNG (2005216) |
| Apt 52 | 2 | Michael J Wilson | Michael J Wilson | OK | MICHAEL J WILSON (2005215) |
|  | 2 |  | ABEL PEREZ | MASTER MISSING | ABEL PEREZ (2005130) |
|  | 2 |  | Robert Bradford | MASTER MISSING | ROBERT BRADFORD (2004866) |
|  | 2 |  | Jerry Rivas | MASTER MISSING | — |
|  | 1 |  | Gage | MASTER MISSING | — |
|  | 2 |  | Richard Fuller | MASTER MISSING | — |
|  | 1 |  | Richard Balderas | MASTER MISSING | RICHARD BALDERAS (2004992) |
|  | 1 |  | Xavier Aaron Addison | MASTER MISSING | XAVIER A ADDISON (2005214) |
|  | 2 |  | Rolando Rene Avitia | MASTER MISSING | — |
|  | 1 |  | Benjamin Zacatzontle | MASTER MISSING | BENJAMIN ZACATZONTLE (2005217) |

## Prairie Hill Village
_master beds=20 · app beds=20_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| 509 rm1 | 1 | Eladio Ramos Jr | Eladio Ramos Jr | OK | ELADIO RAMOS JR (2001255) |
| 509 rm1 | 2 | Pedro Garcia | Pedro Garcia | OK | PEDRO GARCIA (2002202) |
| 509 rm2 | 1 | Lawrence Cortez | Lawrence Cortez | OK | LAWRENCE CORTEZ (2002187) |
| 509 rm2 | 2 | Jonathan Ariola | Jonathan Ariola | OK | JONATHAN ARIOLA (2002201) |
| 510 rm1 | 1 | Carlos Galvez Garcia | Carlos Galvez Garcia | OK | CARLOS GALVEZ GARCIA (2001261) |
| 510 rm2 | 1 | Jacob Zepeda | Jacob Zepeda | OK | JACOB ZEPEDA (2001252) |
| 512 rm1 | 1 | Alexander A Marrero | Alexander A Marrero | OK | ALEXANDER A MARRERO (2002780) |
| 512 rm1 | 2 | Xavior R Robinson | Xavior R Robinson | OK | XAVIOR R ROBINSON (2004678) |
| 512 rm2 | 1 | Alexis Perez | Alexis Perez | OK | ALEXIS PEREZ (2002739) |
| 512 rm2 | 2 | Dorian Kyles | Dorian Kyles | OK | DORIAN KYLES (2004679) |
| 811 rm1 | 1 | Moices Bernal | Moices Bernal | OK | MOICES BERNAL (2004681) |
| 811 rm1 | 2 | Gabriel Romero | Gabriel Romero | OK | GABRIEL ROMERO (2004677) |
| 811 rm2 | 1 | Jacob C Ferguson | Jacob C Ferguson | OK | JACOB C FERGUSON (2004676) |
| 812 rm1 | 1 | Abein Flores | Abein Flores | OK | ABEIN FLORES (2002424) |
| 812 rm1 | 2 | Jose Castro | Jose Castro | OK | JOSE CASTRO (2001690) |
| 812 rm2 | 1 | Antonio Hernandez | Antonio Hernandez | OK | ANTONIO HERNANDEZ (2001265) |
| 812 rm2 | 2 | Ismael Meza | Ismael Meza | OK | ISMAEL MEZA CACERES (2001257) |

## Siren – 7666 South Shore Drive
_master beds=13 · app beds=13_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| Apt #1-1 | 1 | Andres Ayala | Andres Ayala | OK | ANDRES AYALA (2002152) |
| Apt #2-1 | 1 | Felix A. Baez Caballero | Felix A. Baez Caballero | OK | FELIX ANDRES BAEZ CABALLERO (2003283) |
| Apt #2-1 | 2 | Orlando Moreno | Orlando Moreno | OK | ORLANDO MORENO (2003075) |
| Apt #2-2 | 1 | Ricardo Mondragon | Ricardo Mondragon | OK | RICARDO MONDRAGON MERCADO (2002688) |
| Apt #2-2 | 2 | Luis E Ceballos Martinez | Luis E Ceballos Martinez - Basement | OK | LUIS E CEBALLOS MARTINEZ (2003301) |
| Apt #3-1 | 1 | Cory Banuelos | Cory Banuelos | OK | CORY BANUELOS (2002162) |
| Apt #3-1 | 2 | Albert Garcia | Albert Garcia | OK | ALBERT GARCIA (2002150) |
| Apt #3-2 | 1 | Brandon Didonato | Brandon Didonato | OK | BRANDON DIDONATO (2002818) |
| Apt #3-2 | 2 | Miguel Mata | Miguel Mata | OK | MIGUEL MATA (2002151) |

## Webster – 7112 Zielsdorf Drive
_master beds=8 · app beds=8_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| West rm1 | 1 | Willie A. Medina Jr | Willie A. Medina Jr | OK | WILLIE A MEDINA JR (2004792) |
| West rm1 | 2 | Ramon Almeida Ruiz | Ramon Almeida Ruiz | OK | NO MATCH |
| West rm2 | 1 | Cody S. Ogden | Cody S. Ogden | OK | CODY S OGDEN (2004594) |
| West rm2 | 2 | Johnathan M. Reynolds | Johnathan M. Reynolds | OK | JOHNATHAN M REYNOLDS (2004593) |
| East rm1 | 1 | Jordan A. Sanders | Jordan A. Sanders | OK | JORDAN A SANDERS (2004596) |
| East rm1 | 2 | Jordan Doyle | Jordan Doyle | OK | JORDAN DOYLE (2004595) |
| East rm2 | 1 | Fernando D. Reyes | Fernando D. Reyes | OK | NO MATCH |
| East rm2 | 2 | Gabriel M. Vega | Gabriel M. Vega | OK | GABRIEL M VEGA (2004606) |

## Burnett Hinckley – 7th St SE
_master beds=24 · app beds=24_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| 404-304 | 1 | Jayden Robertson |  | APP MISSING | JAYDEN ROBERTSON (2004690) |
| 404-304 | 2 | Devin M. Law | Devin M. Law | OK | NO MATCH |
| 406-205 | 1 | Felix Arroyo | Felix Arroyo - KFI Sup. | OK | NO MATCH |
| 406-205 | 2 | Isidro Guerrero |  | APP MISSING | NO MATCH |
| 406-302 | 1 | Jose Gallegos | Jose Gallegos | OK | JOSE GALLEGOS (2002374) |
| 406-302 | 2 | Luis A. Hernandez | Luis A. Hernandez | OK | LUIS ALBERTO HERNANDEZ (2004372) |
|  | 2 |  | Devin (last name TBD) | MASTER MISSING | DEVIN R NEAL (2005042) |
|  | 2 |  | Frank Quinones | MASTER MISSING | — |

## Hickory Haven Apartments – Gilman, WI
_master beds=10 · app beds=10_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| Apt 6 | 1 | Gilberto Lara | Gilberto Lara | OK | GILBERTO LARA (2004959) |
| Apt 6 | 2 | Francisco (CHOFER) |  | APP MISSING | FRANCISCO BENSON (2004757) |
| Apt 8 | 1 | Andrew Castaneda | Andrew Castaneda | OK | ANDREW J CASTANEDA (2004961) |
| Apt 8 | 2 | Dennis Jordan | Dennis Jordan | OK | DENNIS G JORDAN (2004960) |
| Apt 11 | 1 | Dustin Laslie |  | APP MISSING | NO MATCH |
| Apt 11 | 2 | Martin Hust | Martin Hust | OK | NO MATCH |
| Apt 12 | 1 | Isaiah Young | Isaiah Young | OK | ISAIAH H YOUNG (2005032) |
| Apt 12 | 2 | Jacob Novak | Jacob Novak | OK | JACOB M NOVAK (2005031) |
| Apt 12 (2) | 1 | Sterlin Adams | Sterlin Adams | OK | STERLIN C ADAMS (2005036) |

## Park Place Apartments – Plymouth, MN
_master beds=24 · app beds=24_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| Apt 118 |  | Julio Orgonez | Julio Orgonez | OK | JULIO ORGONEZ (2002940) |
| Apt 118 |  | Raymundo Leija | Raymundo Leija | OK | RAYMUNDO LEIJA (2002939) |
| Apt 118 |  | Ethan Davis | Ethan Davis | OK | ETHAN DAVIS (2002636) |
| Apt 127 |  | Alfred A Beserra | Alfred A Beserra | OK | ALFRED A BESERRA (2004710) |
| Apt 127 |  | David Davis | David Davis - 127 | OK | DAVID DAVIS (2002373) |
| Apt 127 |  | Erasmo Garza | Erasmo Garza | OK | ERASMO GARZA (2002379) |
| Apt 315 |  | Abel A Guzman | Abel A Guzman | OK | ABEL A GUZMAN (2005096) |
| Apt 315 |  | Luis Rodriguez Rivera | Luis Rodriguez Rivera | OK | NO MATCH |
| Apt 315 |  | Nicholas R Franklin | Nicholas R Franklin | OK | NO MATCH |
| Apt 342 |  | Jordan Torres | Jordan Torres | OK | JORDAN TORRES (2002938) |
| Apt 342 |  | Jose Molina | Jose Molina | OK | JOSE MOLINA (2002031) |
| Apt 342 |  | Marcos Antonio Lara | Marcos Antonio Lara | OK | MARCOS ANTONIO LARA (2002820) |
| Apt 201 |  | Evarado Delgado | Evarado Delgado | OK | EVARADO DELGADO (2004070) |
| Apt 201 |  | Jonathan Reynosa | Jonathan Reynosa | OK | NO MATCH |
| Apt 201 |  | Sebastian Villarreal | Sebastian Villarreal | OK | SEBASTIAN VILLARREAL (2005166) |
| Apt 201 |  | Tyrek J Patterson | Tyrek J Patterson | OK | NO MATCH |
| Apt 218 |  | Eduardo Campos | Eduardo Campos | OK | NO MATCH |
| Apt 218 |  | Gabriel J Womack | Gabriel J Womack | OK | GABRIEL J WOMACK (2005111) |
| Apt 218 |  | Gilbert Bustos Jr | Gilbert Bustos JR | OK | GILBERT BUSTOS JR (2002861) |
| Apt 218 |  | Justin Deangelis | Justin Deangelis | OK | JUSTIN DEANGELIS (2005110) |
|  | 2 |  | Joseph Bullock | MASTER MISSING | JOSEPH BULLOCK (2005400) |
|  | 2 |  | Noe Morales | MASTER MISSING | NOE MORALES (2005399) |

## 2900 New Pinery Rd – Portage, WI
_master beds=28 · app beds=28_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| 205 | 1 | Ryan Fiegen | Ryan Fiegen | OK | NO MATCH |
| 205 | 2 | Brandon Johnson | Brandon Johnson | OK | BRANDON M JOHNSON (2005395) |
| 134 | 1 | Claudia M Ramirez |  | APP MISSING | NO MATCH |
| 149 | 1 | Zabdi X Rodriguez | Zabdi X Rodriguez - P6 | OK | ZABDI X RODRIGUEZ (2004956) |
| 149 | 2 | John Tyler Clark | John Tyler Clark - P6 | OK | JOHN T CLARK (2004954) |
| 216 | 1 | Brandon Morgan | Brandon Morgan | OK | BRANDON A MORGAN (2004539) |
| 216 | 2 | Diego Martinez | Diego Martinez | OK | DIEGO MARTINEZ (2005364) |
| 215 | 1 | Evian D Napier |  | APP MISSING | EVIAN D NAPIER (2004989) |
| 215 | 2 | Stephen Archambo |  | APP MISSING | NO MATCH |
| 247 | 1 | Jordan T. Smith | Jordan T. Smith-T7 | OK | JORDAN T SMITH (2004574) |
| 247 | 2 | Trey Grant | Trey Grant-T7 | OK | TREY GRANT (2004572) |
| 122 | 1 | Javien Robinson |  | APP MISSING | JAVIEN ROBINSON (2005586) |
| 122 | 2 | Zion Glover |  | APP MISSING | ZION GLOVER (2005593) |
| 303 | 1 | Ryan Thomas |  | APP MISSING | RYAN THOMAS (2005587) |
| 303 | 2 | Dario Munoz |  | APP MISSING | DARIO MUNOZ (2005588) |
| 232 | 1 | Noah Vaughn |  | APP MISSING | NOAH VAUGHN (2005590) |
| 232 | 2 | Felix M. Rivera |  | APP MISSING | FELIX MIGUEL RIVERA (2005601) |
| 136 | 1 | Sybella Sandoval |  | APP MISSING | NO MATCH |
| 136 | 2 | Dalida M Diaz |  | APP MISSING | NO MATCH |
| S8-207 | 1 | Jason Allen Mills |  | APP MISSING | NO MATCH |
| S8-207 | 2 | Cristian A Jackson |  | APP MISSING | NO MATCH |
| S8-209 | 1 | Logan J Rogers |  | APP MISSING | NO MATCH |
| S8-209 | 2 | Josue D Martinez Garza |  | APP MISSING | NO MATCH |
| S8-211 | 1 | Christian Quinones |  | APP MISSING | NO MATCH |
| S8-211 | 2 | Ethan Hasty |  | APP MISSING | NO MATCH |
| S8-218 | 1 | Trevor Jermaine Horne |  | APP MISSING | NO MATCH |
| S8-218 | 2 | Eric A Brunson |  | APP MISSING | NO MATCH |
| S8-219 | 1 | Alberto Lee Monnar |  | APP MISSING | NO MATCH |
| S8-219 | 2 | Daniel Young |  | APP MISSING | NO MATCH |
| S8-221 | 1 | Jonathan Isaiah Spears | Jonathan P Wheeler - T5 | NAME DIFF | NO MATCH |
|  | 2 |  | Cody Troy Smith - T5 | MASTER MISSING | — |
|  | 1 |  | Jasmine Arce -T4 | MASTER MISSING | — |
|  | 2 |  | Thalia Romero | MASTER MISSING | THALIA MERIAM ROMERO (2005367) |
|  | 1 |  | Jared Novak | MASTER MISSING | JARED M NOVAK (2005365) |
|  | 1 |  | Bucky Lee Gonzalez -T4 | MASTER MISSING | BUCKY LEE GONZALEZ (2004381) |

## 1331 S 8th Ave Apt 200 – Wausau, WI
_master beds=6 · app beds=6_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| Apt 200 rm1 | 1 | Cole C Hayek | Cole C Hayek | OK | COLE C HAYEK (2005106) |
| Apt 200 rm1 | 2 | Erin B Miller | Erin B Miller | OK | ERIN B MILLER (2005107) |
| Apt 200 rm2 | 1 | Joshua B Allen | Joshua B Allen | OK | JOSHUA B ALLEN (2005112) |
| Apt 200 rm2 | 2 | William Johnson | William Johnson | OK | WILLIAM W JOHNSON (2005306) |
| Apt 200 rm3 | 1 | Julian T Lewis | Julian T Lewis | OK | JULIAN T LEWIS (2005109) |
| Apt 200 rm3 | 2 | Elijah Patterson | Elijah Patterson | OK | ELIJAH PATTERSON (2005108) |

## 1341 S 8th Ave Apt 108 – Wausau, WI
_master beds=4 · app beds=4_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| Apt 108 rmA | 1 | Eduardo Solano Rios |  | APP MISSING | NO MATCH |
| Apt 108 rmA | 2 | Jacob Slade Brown |  | APP MISSING | NO MATCH |
| Apt 108 rmB | 1 | Ethan Long |  | APP MISSING | NO MATCH |
| Apt 108 rmB | 2 | James W Hart |  | APP MISSING | NO MATCH |
| Apt 108 rmC | 1 | Andrew B Sweet |  | APP MISSING | NO MATCH |
| Apt 108 rmC | 2 | Austin Crawford |  | APP MISSING | NO MATCH |
|  | 1 |  | Giovanni | MASTER MISSING | — |
|  | 2 |  | Jaylon | MASTER MISSING | — |
|  | 1 |  | Marquis | MASTER MISSING | — |

## E. Bloomfield St Apartments
_master beds=28 · app beds=28_

| Unit | Bed | Master name | App name | Status | Roster match |
|---|---|---|---|---|---|
| 414-3 | 1 | George Cardoso | George Cardoso | OK | GEORGE CARDOSO (2005266) |
| 414-3 | 2 | Kristian W Ordiales | Kristian W Ordiales | OK | KRISTIAN W ORDIALES (2005265) |
| 512-3 | 1 | Richard Balderas |  | APP MISSING | RICHARD BALDERAS (2004992) |
| 512-3 | 2 | Santiago Coello |  | APP MISSING | SANTIAGO COELLO (2005441) |
| 322-2 | 1 | Marcos Garza |  | APP MISSING | MARCOS D GARZA (2005440) |
| 322-2 | 2 | Jose A. Garcia |  | APP MISSING | JOSE ANTONIO GARCIA (2005439) |
| (unit unknown) |  | Stive Pimentel Diaz |  | APP MISSING | STIVE PIMENTEL DIAZ (2005411) |
| (unit unknown) |  | Jonathan Cedeno |  | APP MISSING | JONATHAN D CEDENO MENDOZA (2005212) |
|  | 2 |  | Gilberto Frias | MASTER MISSING | — |
|  | 1 |  | Paul L Jackson | MASTER MISSING | — |

## Needs matching (master names with no confident active-roster match)

| Property | Master name | Closest roster candidates |
|---|---|---|
| Greenock Manor – McKeesport, PA | Alfonso A. Garcia | ALBERT GARCIA (2002150, cov 0.5); CRISTAL GARCIA (2001115, cov 0.5); ERICK F GARCIA (2005293, cov 0.5) |
| Greenock Manor – McKeesport, PA | Ernesto Garcia | ALBERT GARCIA (2002150, cov 0.5); CRISTAL GARCIA (2001115, cov 0.5); ERICK F GARCIA (2005293, cov 0.5) |
| Greenock Manor – McKeesport, PA | Akniel A. Garcia | ALBERT GARCIA (2002150, cov 0.5); CRISTAL GARCIA (2001115, cov 0.5); ERICK F GARCIA (2005293, cov 0.5) |
| Greenock Manor – McKeesport, PA | Mandrell Coretz | MANDRELL CORTEZ (2002420, cov 0.5) |
| Greenock Manor – McKeesport, PA | David D. Navarro | DAVID A BEASLEY (2005029, cov 0.5); DAVID ARROYO (2001597, cov 0.5); DAVID CASTILLO (2002138, cov 0.5) |
| Greenock Manor – McKeesport, PA | Navarro Gabriel | GABRIEL GARCIA (2002873, cov 0.5); GABRIEL GARZA (2001583, cov 0.5); GABRIEL J WOMACK (2005111, cov 0.5) |
| Webster – 7112 Zielsdorf Drive | Ramon Almeida Ruiz | ANTHONY RUIZ (2002680, cov 0.33) |
| Webster – 7112 Zielsdorf Drive | Fernando D. Reyes | ANTONIO REYES (2001989, cov 0.5); ERICA D SILVERIO REYES (2005503, cov 0.5) |
| Burnett Hinckley – 7th St SE | Devin M. Law | DEVIN R NEAL (2005042, cov 0.5) |
| Burnett Hinckley – 7th St SE | Felix Arroyo | DAVID ARROYO (2001597, cov 0.5); FELIX MOYA JR (2000657, cov 0.5); FELIX MIGUEL RIVERA (2005601, cov 0.5) |
| Burnett Hinckley – 7th St SE | Isidro Guerrero | ISIDRO GUTIERREZ (2000843, cov 0.5); TYLER GUERRERO (2002179, cov 0.5) |
| Hickory Haven Apartments – Gilman, WI | Dustin Laslie | none |
| Hickory Haven Apartments – Gilman, WI | Martin Hust | MARTIN CAMACHO (2002245, cov 0.5); MARTIN LEAL (2001677, cov 0.5); RICARDO MENDEZ MARTIN (2000963, cov 0.5) |
| Park Place Apartments – Plymouth, MN | Luis Rodriguez Rivera | LUIS YADIEL RIVERA LA PUERTA (2004226, cov 0.67); DANIEL  RODRIGUEZ (2004086, cov 0.33); ESEQUIEL RODRIGUEZ (2001117, cov 0.33) |
| Park Place Apartments – Plymouth, MN | Nicholas R Franklin | none |
| Park Place Apartments – Plymouth, MN | Jonathan Reynosa | JONATHAN ARIOLA (2002201, cov 0.5); JONATHAN D CEDENO MENDOZA (2005212, cov 0.5); JONATHAN LARA LOPEZ (2002019, cov 0.5) |
| Park Place Apartments – Plymouth, MN | Tyrek J Patterson | ELIJAH PATTERSON (2005108, cov 0.5) |
| Park Place Apartments – Plymouth, MN | Eduardo Campos | EDUARDO ALVAREZ (2005024, cov 0.5); RUBEN CAMPOS (2005283, cov 0.5); MIGUEL EDUARDO ORTEGA (2004405, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Ryan Fiegen | RYAN  HALL (2003086, cov 0.5); RYAN THOMAS (2005587, cov 0.5); ANTHONY RYAN ALI (2005557, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Claudia M Ramirez | CLAUDIA Y VILLALOBOS (2005292, cov 0.5); ANDDY  RAMIREZ PEDRAZA (2003120, cov 0.5); CESAR O MARQUEZ RAMIREZ (2004524, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Stephen Archambo | none |
| 2900 New Pinery Rd – Portage, WI | Sybella Sandoval | none |
| 2900 New Pinery Rd – Portage, WI | Dalida M Diaz | JAKE DIAZ GUZMAN (2002864, cov 0.5); STIVE PIMENTEL DIAZ (2005411, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Jason Allen Mills | JASON ROMERO (2002038, cov 0.33); JOSHUA B ALLEN (2005112, cov 0.33) |
| 2900 New Pinery Rd – Portage, WI | Cristian A Jackson | none |
| 2900 New Pinery Rd – Portage, WI | Logan J Rogers | none |
| 2900 New Pinery Rd – Portage, WI | Josue D Martinez Garza | AGUSTINA GARZA (2001984, cov 0.33); CARLOS MARTINEZ (2001611, cov 0.33); DIEGO MARTINEZ (2005364, cov 0.33) |
| 2900 New Pinery Rd – Portage, WI | Christian Quinones | CHRISTIAN BURTON (2004643, cov 0.5); CHRISTIAN FRIAS (2004688, cov 0.5); CHRISTIAN HUNTER (2004618, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Ethan Hasty | ETHAN DAVIS (2002636, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Trevor Jermaine Horne | none |
| 2900 New Pinery Rd – Portage, WI | Eric A Brunson | ERIC C BROWN (2005264, cov 0.5); ERIC D MOORE (2004687, cov 0.5); ERIC VICENT (2001504, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Alberto Lee Monnar | BRANDON LEE (2004379, cov 0.33); CEDRIC T LEE (2004528, cov 0.33); ELIJAH M LEE (2004418, cov 0.33) |
| 2900 New Pinery Rd – Portage, WI | Daniel Young | DANIEL  RODRIGUEZ (2004086, cov 0.5); DANIEL CISNEROS (2001850, cov 0.5); DANIEL HERRERA (2001613, cov 0.5) |
| 2900 New Pinery Rd – Portage, WI | Jonathan Isaiah Spears | ISAIAH H YOUNG (2005032, cov 0.33); ISAIAH HALL (2002422, cov 0.33); JONATHAN ARIOLA (2002201, cov 0.33) |
| 1341 S 8th Ave Apt 108 – Wausau, WI | Eduardo Solano Rios | EDUARDO ALVAREZ (2005024, cov 0.33); FRANCISCO J RIOS JR (2004305, cov 0.33); MIGUEL EDUARDO ORTEGA (2004405, cov 0.33) |
| 1341 S 8th Ave Apt 108 – Wausau, WI | Jacob Slade Brown | ALEXIS BROWN (2004376, cov 0.33); ERIC C BROWN (2005264, cov 0.33); JACOB BUSH (2005021, cov 0.33) |
| 1341 S 8th Ave Apt 108 – Wausau, WI | Ethan Long | ETHAN DAVIS (2002636, cov 0.5) |
| 1341 S 8th Ave Apt 108 – Wausau, WI | James W Hart | JAMES ALVARADO (2001240, cov 0.5); JAMES MURRAY JR (2002632, cov 0.5) |
| 1341 S 8th Ave Apt 108 – Wausau, WI | Andrew B Sweet | ANDREW CRUZ (2000816, cov 0.5); ANDREW GRANVILLE (2004810, cov 0.5); ANDREW HERNANDEZ (2003072, cov 0.5) |
| 1341 S 8th Ave Apt 108 – Wausau, WI | Austin Crawford | none |

## Bed count mismatches (master total vs app total)

_none reported_
