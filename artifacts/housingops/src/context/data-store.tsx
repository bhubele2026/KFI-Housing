import { createContext, useContext, useState, ReactNode } from "react";
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
  updateBed: (id: string, updates: Partial<Bed>) => void;
  updateOccupant: (id: string, updates: Partial<Occupant>) => void;
  addOccupant: (occupant: Occupant) => void;
  updateUtility: (id: string, updates: Partial<Utility>) => void;
  addUtility: (utility: Utility) => void;
  deleteUtility: (id: string) => void;
}

const DataContext = createContext<DataStore | undefined>(undefined);

export function DataProvider({ children }: { children: ReactNode }) {
  const [properties, setProperties] = useState<Property[]>(MOCK_PROPERTIES);
  const [leases, setLeases] = useState<Lease[]>(MOCK_LEASES);
  const [beds, setBeds] = useState<Bed[]>(MOCK_BEDS);
  const [occupants, setOccupants] = useState<Occupant[]>(MOCK_OCCUPANTS);
  const [utilities, setUtilities] = useState<Utility[]>(MOCK_UTILITIES);

  const updateProperty = (id: string, updates: Partial<Property>) =>
    setProperties(prev => prev.map(p => (p.id === id ? { ...p, ...updates } : p)));

  const updateLease = (id: string, updates: Partial<Lease>) =>
    setLeases(prev => prev.map(l => (l.id === id ? { ...l, ...updates } : l)));

  const addLease = (lease: Lease) => setLeases(prev => [...prev, lease]);
  const deleteLease = (id: string) => setLeases(prev => prev.filter(l => l.id !== id));

  const updateBed = (id: string, updates: Partial<Bed>) =>
    setBeds(prev => prev.map(b => (b.id === id ? { ...b, ...updates } : b)));

  const updateOccupant = (id: string, updates: Partial<Occupant>) =>
    setOccupants(prev => prev.map(o => (o.id === id ? { ...o, ...updates } : o)));

  const addOccupant = (occupant: Occupant) => setOccupants(prev => [...prev, occupant]);

  const updateUtility = (id: string, updates: Partial<Utility>) =>
    setUtilities(prev => prev.map(u => (u.id === id ? { ...u, ...updates } : u)));

  const addUtility = (utility: Utility) => setUtilities(prev => [...prev, utility]);
  const deleteUtility = (id: string) => setUtilities(prev => prev.filter(u => u.id !== id));

  return (
    <DataContext.Provider value={{
      properties, leases, beds, occupants, utilities,
      updateProperty, updateLease, addLease, deleteLease,
      updateBed, updateOccupant, addOccupant,
      updateUtility, addUtility, deleteUtility,
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
