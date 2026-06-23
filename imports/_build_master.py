#!/usr/bin/env python3
# Assemble _master_occupancy.json from the per-property grids extracted from
# "Housing Master File 2026.xlsx" (one tab/block per property) + my own read of the
# Hickory Haven (Gilman, WI) sheet. Bloomfield/Wausau added separately once available.
import json, os
D=os.path.dirname(os.path.abspath(__file__))

def U(unit,bed,name): return {"unit":unit,"bed":bed,"masterName":name}

master={}

# ---- GREENOCK MANOR (Shuster's) — app prop-shusters-900-seneca-mckeesport ----
master["prop-shusters-900-seneca-mckeesport"]={
 "name":"Greenock Manor – McKeesport, PA","totalBeds":28,
 "units":[
  U("Apt 45",1,"Harold Covington"),U("Apt 45",2,"Alfonso A. Garcia"),U("Apt 45",3,"Ernesto Garcia"),U("Apt 45",4,"Akniel A. Garcia"),
  U("Apt 36",1,"Justin Martinez"),U("Apt 36",2,"Derrick Black"),
  U("Apt 48",1,"Tony Perry"),U("Apt 48",2,"Christopher Hill"),U("Apt 48",3,"Tyler Smith"),U("Apt 48",4,"Jared Lemert"),
  U("Apt 49",1,"Mandrell Coretz"),U("Apt 49",2,"Joy Doran"),U("Apt 49",3,"David D. Navarro"),U("Apt 49",4,"Navarro Gabriel"),
  U("Apt 32",2,"Sam Houston"),U("Apt 32",3,"Christian Decuire"),
  U("Apt 42",1,"Timothy Rouse"),U("Apt 42",2,"Jacob Mullinax"),U("Apt 42",3,"Richard Russell"),
  U("Apt 52",1,"Lucas J Young"),U("Apt 52",2,"Michael J Wilson"),
 ]}

# ---- PRAIRIE HILL VILLAGE (Milwaukee Valve) — prop-prairie-hill-village ----
master["prop-prairie-hill-village"]={
 "name":"Prairie Hill Village","totalBeds":20,
 "units":[
  U("509 rm1",1,"Eladio Ramos Jr"),U("509 rm1",2,"Pedro Garcia"),
  U("509 rm2",1,"Lawrence Cortez"),U("509 rm2",2,"Jonathan Ariola"),
  U("510 rm1",1,"Carlos Galvez Garcia"),
  U("510 rm2",1,"Jacob Zepeda"),
  U("512 rm1",1,"Alexander A Marrero"),U("512 rm1",2,"Xavior R Robinson"),
  U("512 rm2",1,"Alexis Perez"),U("512 rm2",2,"Dorian Kyles"),
  U("811 rm1",1,"Moices Bernal"),U("811 rm1",2,"Gabriel Romero"),
  U("811 rm2",1,"Jacob C Ferguson"),
  U("812 rm1",1,"Abein Flores"),U("812 rm1",2,"Jose Castro"),
  U("812 rm2",1,"Antonio Hernandez"),U("812 rm2",2,"Ismael Meza"),
 ]}

# ---- SIREN (Burnett) — prop-burnett-siren-7666-south-shore ----
master["prop-burnett-siren-7666-south-shore"]={
 "name":"Siren – 7666 South Shore Drive","totalBeds":13,
 "units":[
  U("Apt #1-1",1,"Andres Ayala"),
  U("Apt #2-1",1,"Felix A. Baez Caballero"),U("Apt #2-1",2,"Orlando Moreno"),
  U("Apt #2-2",1,"Ricardo Mondragon"),U("Apt #2-2",2,"Luis E Ceballos Martinez"),
  U("Apt #3-1",1,"Cory Banuelos"),U("Apt #3-1",2,"Albert Garcia"),
  U("Apt #3-2",1,"Brandon Didonato"),U("Apt #3-2",2,"Miguel Mata"),
 ]}

# ---- WEBSTER (Burnett) — prop-burnett-webster-7112-zielsdorf ----
master["prop-burnett-webster-7112-zielsdorf"]={
 "name":"Webster – 7112 Zielsdorf Drive","totalBeds":8,
 "units":[
  U("West rm1",1,"Willie A. Medina Jr"),U("West rm1",2,"Ramon Almeida Ruiz"),
  U("West rm2",1,"Cody S. Ogden"),U("West rm2",2,"Johnathan M. Reynolds"),
  U("East rm1",1,"Jordan A. Sanders"),U("East rm1",2,"Jordan Doyle"),
  U("East rm2",1,"Fernando D. Reyes"),U("East rm2",2,"Gabriel M. Vega"),
 ]}

# ---- HINCKLEY (Burnett) — prop-burnett-hinckley-7th-st-se ----
# Using the occupancy-grid block reading. Grid vs roster conflicts flagged in notes.
master["prop-burnett-hinckley-7th-st-se"]={
 "name":"Burnett Hinckley – 7th St SE","totalBeds":24,
 "note":"Master grid and master employee-roster disagree heavily for Hinckley; grid reading used.",
 "units":[
  U("404-304",1,"Jayden Robertson"),U("404-304",2,"Devin M. Law"),
  U("406-205",1,"Felix Arroyo"),U("406-205",2,"Isidro Guerrero"),
  U("406-302",1,"Jose Gallegos"),U("406-302",2,"Luis A. Hernandez"),
 ]}

# ---- HICKORY HAVEN (Gilman, WI / WB Mfg) — prop-hickory-haven-gilman ----
# From my own read of "Gilman, WI.xlsx" occupancy grid (Apt/Bed/Person).
master["prop-hickory-haven-gilman"]={
 "name":"Hickory Haven Apartments – Gilman, WI","totalBeds":10,
 "units":[
  U("Apt 6",1,"Gilberto Lara"),U("Apt 6",2,"Francisco (CHOFER)"),
  U("Apt 8",1,"Andrew Castaneda"),U("Apt 8",2,"Dennis Jordan"),
  U("Apt 11",1,"Dustin Laslie"),U("Apt 11",2,"Martin Hust"),
  U("Apt 12",1,"Isaiah Young"),U("Apt 12",2,"Jacob Novak"),
  U("Apt 12 (2)",1,"Sterlin Adams"),
 ]}

# ---- PARK PLACE (Landscape Structures) — prop-park-place-plymouth ----
# Master file gives UNIT-level names (no bed numbers); bed=None.
master["prop-park-place-plymouth"]={
 "name":"Park Place Apartments – Plymouth, MN","totalBeds":24,
 "note":"Master file lists Park Place at unit level (no bed numbers); master subtotals internally inconsistent (16 vs 24).",
 "units":[
  U("Apt 118",None,"Julio Orgonez"),U("Apt 118",None,"Raymundo Leija"),U("Apt 118",None,"Ethan Davis"),
  U("Apt 127",None,"Alfred A Beserra"),U("Apt 127",None,"David Davis"),U("Apt 127",None,"Erasmo Garza"),
  U("Apt 315",None,"Abel A Guzman"),U("Apt 315",None,"Luis Rodriguez Rivera"),U("Apt 315",None,"Nicholas R Franklin"),
  U("Apt 342",None,"Jordan Torres"),U("Apt 342",None,"Jose Molina"),U("Apt 342",None,"Marcos Antonio Lara"),
  U("Apt 201",None,"Evarado Delgado"),U("Apt 201",None,"Jonathan Reynosa"),U("Apt 201",None,"Sebastian Villarreal"),U("Apt 201",None,"Tyrek J Patterson"),
  U("Apt 218",None,"Eduardo Campos"),U("Apt 218",None,"Gabriel J Womack"),U("Apt 218",None,"Gilbert Bustos Jr"),U("Apt 218",None,"Justin Deangelis"),
 ]}

# ---- THE RIDGE / 2900 New Pinery (Penda/Trienda) — prop-penda-2900-new-pinery ----
# Using the master-file Portage tab (newer; room numbers match app: 134,149,216,247,205,122,215,305...).
master["prop-penda-2900-new-pinery"]={
 "name":"2900 New Pinery Rd – Portage, WI","totalBeds":28,
 "note":"Master 'Portage' tab used (newer than standalone ridge roster). Master adds S8-series rooms (~30 cap) not in app.",
 "units":[
  U("205",1,"Ryan Fiegen"),U("205",2,"Brandon Johnson"),
  U("134",1,"Claudia M Ramirez"),
  U("149",1,"Zabdi X Rodriguez"),U("149",2,"John Tyler Clark"),
  U("216",1,"Brandon Morgan"),U("216",2,"Diego Martinez"),
  U("215",1,"Evian D Napier"),U("215",2,"Stephen Archambo"),
  U("247",1,"Jordan T. Smith"),U("247",2,"Trey Grant"),
  U("122",1,"Javien Robinson"),U("122",2,"Zion Glover"),
  U("303",1,"Ryan Thomas"),U("303",2,"Dario Munoz"),
  U("232",1,"Noah Vaughn"),U("232",2,"Felix M. Rivera"),
  U("136",1,"Sybella Sandoval"),U("136",2,"Dalida M Diaz"),
  U("S8-207",1,"Jason Allen Mills"),U("S8-207",2,"Cristian A Jackson"),
  U("S8-209",1,"Logan J Rogers"),U("S8-209",2,"Josue D Martinez Garza"),
  U("S8-211",1,"Christian Quinones"),U("S8-211",2,"Ethan Hasty"),
  U("S8-218",1,"Trevor Jermaine Horne"),U("S8-218",2,"Eric A Brunson"),
  U("S8-219",1,"Alberto Lee Monnar"),U("S8-219",2,"Daniel Young"),
  U("S8-221",1,"Jonathan Isaiah Spears"),
 ]}

# ---- WAUSAU APT 200 (Schuette Metals) — prop-schuette-1331-s-8th-apt-200 ----
master["prop-schuette-1331-s-8th-apt-200"]={
 "name":"1331 S 8th Ave Apt 200 – Wausau, WI","totalBeds":6,
 "note":"Master merges Apt200/108/208 in one block; Apt 200 names clean. Master had no bed numbers per person.",
 "units":[
  U("Apt 200 rm1",1,"Cole C Hayek"),U("Apt 200 rm1",2,"Erin B Miller"),
  U("Apt 200 rm2",1,"Joshua B Allen"),U("Apt 200 rm2",2,"William Johnson"),
  U("Apt 200 rm3",1,"Julian T Lewis"),U("Apt 200 rm3",2,"Elijah Patterson"),
 ]}

# ---- WAUSAU APT 108 (Schuette Metals) — prop-schuette-1341-s-8th-apt-108 ----
# Master shows 6/12/2026 move-in group, DIFFERENT from app's 3 occupants.
master["prop-schuette-1341-s-8th-apt-108"]={
 "name":"1341 S 8th Ave Apt 108 – Wausau, WI","totalBeds":4,
 "note":"Master 108 names are the 6/12/2026 move-in group; entirely different from app's current occupants.",
 "units":[
  U("Apt 108 rmA",1,"Eduardo Solano Rios"),U("Apt 108 rmA",2,"Jacob Slade Brown"),
  U("Apt 108 rmB",1,"Ethan Long"),U("Apt 108 rmB",2,"James W Hart"),
  U("Apt 108 rmC",1,"Andrew B Sweet"),U("Apt 108 rmC",2,"Austin Crawford"),
 ]}

# ---- BLOOMFIELD GARDENS (International Wire) — prop-iwg-bloomfield-st ----
# Master grid misaligned/mostly blank; only 414-3 reliably maps. Other names listed unit-unknown.
master["prop-iwg-bloomfield-st"]={
 "name":"E. Bloomfield St Apartments","totalBeds":28,
 "note":"Master Bloomfield grid truncated/misaligned; per-bed mapping not recoverable. Only 414-3 reliable; other master names recorded with unit unknown.",
 "units":[
  U("414-3",1,"George Cardoso"),U("414-3",2,"Kristian W Ordiales"),
  U("512-3",1,"Richard Balderas"),U("512-3",2,"Santiago Coello"),
  U("322-2",1,"Marcos Garza"),U("322-2",2,"Jose A. Garcia"),
  U("(unit unknown)",None,"Stive Pimentel Diaz"),
  U("(unit unknown)",None,"Jonathan Cedeno"),
 ]}

json.dump(master,open(os.path.join(D,'_master_occupancy.json'),'w'),indent=1)
print("wrote", len(master),"properties; total master rows",sum(len(p['units']) for p in master.values()))
