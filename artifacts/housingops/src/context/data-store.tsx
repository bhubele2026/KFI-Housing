import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import {
  MOCK_PROPERTIES, MOCK_LEASES, MOCK_BEDS, MOCK_OCCUPANTS, MOCK_UTILITIES,
  Property, Lease, Bed, Occupant, Utility,
} from "@/data/mockData";

interface DataStore {
  properties: Property[];
  leases: Lease[];
  beds: Bed[];
  occupants: Occupant[];
  utilities: Utility[];
  updateProperty: (id: string, updates: Partial<Property>) => void;
  updateLease: (id: string, updates: Partial<Lease>) => void;
  addLease: (lease: Lease) => void;
  deleteLease: (id: string) => void;
  addBed: (bed: Bed) => void;
  deleteBed: (id: string) => void;
  updateBed: (id: string, updates: Partial<Bed>) => void;
  updateOccupant: (id: string, updates: Partial<Occupant>) => void;
  addOccupant: (occupant: Occupant) => void;
  updateUtility: (id: string, updates: Partial<Utility>) => void;
  addUtility: (utility: Utility) => void;
  deleteUtility: (id: string) => void;
  resetToSampleData: () => void;
}

const DataContext = createContext<DataStore | undefined>(undefined);

const STORAGE_PREFIX = "housingops:v1:";
const KEYS = {
  properties: `${STORAGE_PREFIX}properties`,
  leases: `${STORAGE_PREFIX}leases`,
  beds: `${STORAGE_PREFIX}beds`,
  occupants: `${STORAGE_PREFIX}occupants`,
  utilities: `${STORAGE_PREFIX}utilities`,
} as const;

function loadFromStorage<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function saveToStorage<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota / serialization errors so a single bad write doesn't crash the app.
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState<Property[]>(() =>
    loadFromStorage(KEYS.properties, MOCK_PROPERTIES),
  );
  const [leases, setLeases] = useState<Lease[]>(() =>
    loadFromStorage(KEYS.leases, MOCK_LEASES),
  );
  const [beds, setBeds] = useState<Bed[]>(() =>
    loadFromStorage(KEYS.beds, MOCK_BEDS),
  );
  const [occupants, setOccupants] = useState<Occupant[]>(() =>
    loadFromStorage(KEYS.occupants, MOCK_OCCUPANTS),
  );
  const [utilities, setUtilities] = useState<Utility[]>(() =>
    loadFromStorage(KEYS.utilities, MOCK_UTILITIES),
  );

  useEffect(() => saveToStorage(KEYS.properties, properties), [properties]);
  useEffect(() => saveToStorage(KEYS.leases, leases), [leases]);
  useEffect(() => saveToStorage(KEYS.beds, beds), [beds]);
  useEffect(() => saveToStorage(KEYS.occupants, occupants), [occupants]);
  useEffect(() => saveToStorage(KEYS.utilities, utilities), [utilities]);

  const updateProperty = (id: string, updates: Partial<Property>) =>
    setProperties(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));

  const updateLease = (id: string, updates: Partial<Lease>) =>
    setLeases(prev => prev.map(l => (l.id === id ? { ...l, ...updates } : l)));

  const addLease = (lease: Lease) => setLeases(prev => [...prev, lease]);
  const deleteLease = (id: string) => setLeases(prev => prev.filter(l => l.id !== id));

  const addBed = (bed: Bed) => setBeds(prev => [...prev, bed]);
  const deleteBed = (id: string) => setBeds(prev => prev.filter(b => b.id !== id));

  const updateBed = (id: string, updates: Partial<Bed>) =>
    setBeds(prev => prev.map(b => (b.id === id ? { ...b, ...updates } : b)));

  const updateOccupant = (id: string, updates: Partial<Occupant>) =>
    setOccupants(prev => prev.map(o => (o.id === id ? { ...o, ...updates } : o)));

  const addOccupant = (occupant: Occupant) => setOccupants(prev => [...prev, occupant]);

  const updateUtility = (id: string, updates: Partial<Utility>) =>
    setUtilities(prev => prev.map(u => (u.id === id ? { ...u, ...updates } : u)));

  const addUtility = (utility: Utility) => setUtilities(prev => [...prev, utility]);
  const deleteUtility = (id: string) => setUtilities(prev => prev.filter(u => u.id !== id));

  const resetToSampleData = () => {
    if (typeof window !== "undefined") {
      try {
        for (const key of Object.values(KEYS)) {
          window.localStorage.removeItem(key);
        }
      } catch {
        // Ignore storage errors; in-memory state will still be reset below.
      }
    }
    setProperties(MOCK_PROPERTIES);
    setLeases(MOCK_LEASES);
    setBeds(MOCK_BEDS);
    setOccupants(MOCK_OCCUPANTS);
    setUtilities(MOCK_UTILITIES);
  };

  return (
    <DataContext.Provider value={{
      properties, leases, beds, occupants, utilities,
      updateProperty, updateLease, addLease, deleteLease,
      addBed, deleteBed, updateBed, updateOccupant, addOccupant,
      updateUtility, addUtility, deleteUtility,
      resetToSampleData,
    }}>
      {children}
    </DataContext.Provider>
  );
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used within DataProvider");
  return ctx;
}
