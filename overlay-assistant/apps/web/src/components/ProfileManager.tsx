import React, { useState, useEffect, useCallback } from "react";

/**
 * Product Profile — what the user is selling.
 * Stored in localStorage so it persists across sessions.
 */
export type ProductProfile = {
  id: string;
  name: string;
  productName: string;
  pricingTiers: string;
  keyDifferentiators: string;
  competitors: string;
  targetIndustry: string;
  commonObjections: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "salescoach_profiles";
const ACTIVE_KEY = "salescoach_active_profile";

function generateId() {
  return `prof_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function loadProfiles(): ProductProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveProfiles(profiles: ProductProfile[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

function loadActiveId(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

function saveActiveId(id: string | null) {
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
}

function newProfile(): ProductProfile {
  return {
    id: generateId(),
    name: "New Profile",
    productName: "",
    pricingTiers: "",
    keyDifferentiators: "",
    competitors: "",
    targetIndustry: "",
    commonObjections: "",
    notes: "",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function ProfileManager({
  isOpen,
  onClose,
  onActiveProfileChange,
}: {
  isOpen: boolean;
  onClose: () => void;
  onActiveProfileChange: (profile: ProductProfile | null) => void;
}) {
  const [profiles, setProfiles] = useState<ProductProfile[]>(() => loadProfiles());
  const [activeId, setActiveId] = useState<string | null>(() => loadActiveId());
  const [editingId, setEditingId] = useState<string | null>(null);

  // Persist changes
  useEffect(() => {
    saveProfiles(profiles);
  }, [profiles]);

  useEffect(() => {
    saveActiveId(activeId);
    const active = profiles.find((p) => p.id === activeId) ?? null;
    onActiveProfileChange(active);
  }, [activeId, profiles]);

  const addProfile = useCallback(() => {
    const p = newProfile();
    setProfiles((prev) => [...prev, p]);
    setEditingId(p.id);
    setActiveId(p.id);
  }, []);

  const deleteProfile = useCallback((id: string) => {
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    if (activeId === id) setActiveId(null);
    if (editingId === id) setEditingId(null);
  }, [activeId, editingId]);

  const duplicateProfile = useCallback((id: string) => {
    const source = profiles.find((p) => p.id === id);
    if (!source) return;
    const dup: ProductProfile = {
      ...source,
      id: generateId(),
      name: `${source.name} (Copy)`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setProfiles((prev) => [...prev, dup]);
    setEditingId(dup.id);
  }, [profiles]);

  const updateField = useCallback((id: string, field: keyof ProductProfile, value: string) => {
    setProfiles((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, [field]: value, updatedAt: new Date().toISOString() } : p
      )
    );
  }, []);

  if (!isOpen) return null;

  const editingProfile = profiles.find((p) => p.id === editingId);

  return (
    <div className="profile-overlay" onClick={onClose}>
      <div className="profile-panel" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="profile-panel-header">
          <div>
            <h2 className="profile-panel-title">Product Profiles</h2>
            <p className="profile-panel-subtitle">
              Set up what you're selling — guidance will adapt to your product.
            </p>
          </div>
          <button className="profile-close-btn" onClick={onClose} aria-label="Close profiles">
            ✕
          </button>
        </div>

        <div className="profile-body">
          {/* Sidebar: profile list */}
          <div className="profile-sidebar">
            <button className="profile-add-btn" onClick={addProfile}>
              <span className="profile-add-icon">+</span>
              New Profile
            </button>

            <div className="profile-list">
              {profiles.length === 0 && (
                <div className="profile-empty">
                  No profiles yet. Create one to get product-aware guidance.
                </div>
              )}
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className={`profile-list-item ${p.id === activeId ? "profile-list-item--active" : ""} ${p.id === editingId ? "profile-list-item--editing" : ""}`}
                  onClick={() => setEditingId(p.id)}
                >
                  <div className="profile-list-item-name">{p.name || "Untitled"}</div>
                  <div className="profile-list-item-product">{p.productName || "No product set"}</div>
                  <div className="profile-list-item-actions">
                    <button
                      className={`profile-activate-btn ${p.id === activeId ? "profile-activate-btn--active" : ""}`}
                      onClick={(e) => { e.stopPropagation(); setActiveId(p.id === activeId ? null : p.id); }}
                    >
                      {p.id === activeId ? "● Active" : "○ Activate"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Editor */}
          <div className="profile-editor">
            {editingProfile ? (
              <>
                <div className="profile-editor-header">
                  <h3 className="profile-editor-title">Editing: {editingProfile.name || "Untitled"}</h3>
                  <div className="profile-editor-actions">
                    <button className="btn-luxury btn-luxury--sm btn-luxury--ghost" onClick={() => duplicateProfile(editingProfile.id)}>
                      Duplicate
                    </button>
                    <button className="btn-luxury btn-luxury--sm btn-luxury--danger" onClick={() => deleteProfile(editingProfile.id)}>
                      Delete
                    </button>
                  </div>
                </div>

                <div className="profile-form">
                  <div className="profile-field">
                    <label className="profile-label">Profile Name</label>
                    <input
                      className="profile-input"
                      value={editingProfile.name}
                      onChange={(e) => updateField(editingProfile.id, "name", e.target.value)}
                      placeholder="e.g. Enterprise CRM Package"
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Product / Service Name</label>
                    <input
                      className="profile-input"
                      value={editingProfile.productName}
                      onChange={(e) => updateField(editingProfile.id, "productName", e.target.value)}
                      placeholder="e.g. Acme CRM Pro"
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Pricing Tiers</label>
                    <textarea
                      className="profile-textarea"
                      value={editingProfile.pricingTiers}
                      onChange={(e) => updateField(editingProfile.id, "pricingTiers", e.target.value)}
                      placeholder="e.g. Starter: $29/mo, Pro: $99/mo, Enterprise: Custom"
                      rows={3}
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Key Differentiators</label>
                    <textarea
                      className="profile-textarea"
                      value={editingProfile.keyDifferentiators}
                      onChange={(e) => updateField(editingProfile.id, "keyDifferentiators", e.target.value)}
                      placeholder="What makes your product stand out? List your top selling points."
                      rows={3}
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Competitors</label>
                    <textarea
                      className="profile-textarea"
                      value={editingProfile.competitors}
                      onChange={(e) => updateField(editingProfile.id, "competitors", e.target.value)}
                      placeholder="e.g. Salesforce, HubSpot, Pipedrive — and why you're better"
                      rows={3}
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Target Industry</label>
                    <input
                      className="profile-input"
                      value={editingProfile.targetIndustry}
                      onChange={(e) => updateField(editingProfile.id, "targetIndustry", e.target.value)}
                      placeholder="e.g. SaaS, Healthcare, Financial Services"
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Common Objections & Rebuttals</label>
                    <textarea
                      className="profile-textarea"
                      value={editingProfile.commonObjections}
                      onChange={(e) => updateField(editingProfile.id, "commonObjections", e.target.value)}
                      placeholder="List objections you hear often and your best responses to each."
                      rows={4}
                    />
                  </div>

                  <div className="profile-field">
                    <label className="profile-label">Additional Notes</label>
                    <textarea
                      className="profile-textarea"
                      value={editingProfile.notes}
                      onChange={(e) => updateField(editingProfile.id, "notes", e.target.value)}
                      placeholder="Anything else — company background, case studies, special offers…"
                      rows={3}
                    />
                  </div>
                </div>
              </>
            ) : (
              <div className="profile-editor-empty">
                <div className="profile-editor-empty-icon">📦</div>
                <div className="profile-editor-empty-title">Select a profile to edit</div>
                <div className="profile-editor-empty-text">
                  Or create a new one to start customizing your sales guidance.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
