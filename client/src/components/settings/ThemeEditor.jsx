/**
 * ThemeEditor Component (v2.11.0)
 *
 * Visual editor for creating and modifying custom themes.
 * Provides color pickers organized by category and a live preview.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ColorPicker from '../ui/ColorPicker.jsx';
import { LoadingSpinner } from '../ui/SimpleComponents.jsx';
import {
  THEME_VARIABLE_GROUPS,
  DEFAULT_THEME_VARIABLES,
  getCurrentThemeVariables,
} from '../../hooks/useTheme.js';
import { THEMES } from '../../config/themes.js';
import { formatError } from '../../../messages.js';
import { T } from '../../config/terminology.js';

const ThemeEditor = ({
  theme = null, // Existing theme to edit, or null for new theme
  onSave,
  onCancel,
  fetchAPI,
  showToast,
}) => {
  const [name, setName] = useState(theme?.name || '');
  const [description, setDescription] = useState(theme?.description || '');
  const [isPublic, setIsPublic] = useState(theme?.isPublic || false);
  const [variables, setVariables] = useState(theme?.variables || { ...DEFAULT_THEME_VARIABLES });
  const [saving, setSaving] = useState(false);
  const [baseTheme, setBaseTheme] = useState('serenity');

  const isEditing = !!theme?.id;

  // Initialize from existing theme or get current theme variables
  useEffect(() => {
    if (theme?.variables) {
      setVariables(theme.variables);
    } else {
      // For new themes, start with current computed values
      setVariables(getCurrentThemeVariables());
    }
  }, [theme]);

  // Load variables from a base theme
  const loadFromBaseTheme = useCallback((themeId) => {
    setBaseTheme(themeId);

    // Temporarily apply the theme to get its computed values
    const currentTheme = document.documentElement.getAttribute('data-theme');
    document.documentElement.setAttribute('data-theme', themeId);

    // Get computed values
    const newVariables = getCurrentThemeVariables();
    setVariables(newVariables);

    // Restore current theme
    document.documentElement.setAttribute('data-theme', currentTheme);
  }, []);

  // Update a single variable
  const updateVariable = useCallback((key, value) => {
    setVariables(prev => ({
      ...prev,
      [key]: value,
    }));
  }, []);

  // Preview variables by temporarily applying them
  const previewVariables = useMemo(() => {
    // Create style string for preview
    return Object.entries(variables)
      .map(([key, value]) => `${key}: ${value}`)
      .join('; ');
  }, [variables]);

  // Save theme
  const handleSave = async () => {
    if (!name.trim()) {
      showToast('Please enter a theme name', 'error');
      return;
    }

    setSaving(true);
    try {
      let result;
      if (isEditing) {
        // Update existing theme
        result = await fetchAPI(`/themes/${theme.id}`, {
          method: 'PUT',
          body: {
            name: name.trim(),
            description: description.trim(),
            variables,
            isPublic,
          },
        });
      } else {
        // Create new theme
        result = await fetchAPI('/themes', {
          method: 'POST',
          body: {
            name: name.trim(),
            description: description.trim(),
            variables,
            isPublic,
          },
        });
      }

      if (result.error) {
        showToast(formatError(result.error), 'error');
        return;
      }

      showToast(isEditing ? 'Theme updated' : 'Theme created', 'success');
      onSave(result.theme || result);
    } catch (error) {
      console.error('Error saving theme:', error);
      showToast(formatError('Failed to save theme'), 'error');
    } finally {
      setSaving(false);
    }
  };

  // Export theme as JSON
  const handleExport = () => {
    const themeData = {
      name,
      description,
      variables,
    };
    const blob = new Blob([JSON.stringify(themeData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name || 'custom-theme'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Import theme from JSON
  const handleImport = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = JSON.parse(event.target.result);
        if (data.name) setName(data.name);
        if (data.description) setDescription(data.description);
        if (data.variables) setVariables(data.variables);
        showToast('Theme imported', 'success');
      } catch (error) {
        showToast(formatError('Invalid theme file'), 'error');
      }
    };
    reader.readAsText(file);
  };

  const styles = {
    container: {
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      maxHeight: '80vh',
      overflow: 'hidden',
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px',
      borderBottom: '1px solid var(--border-primary)',
      flexShrink: 0,
    },
    title: {
      margin: 0,
      fontSize: '1.1rem',
      color: 'var(--text-primary)',
    },
    headerButtons: {
      display: 'flex',
      gap: '8px',
    },
    content: {
      flex: 1,
      overflow: 'auto',
      padding: '16px',
    },
    section: {
      marginBottom: '24px',
    },
    sectionTitle: {
      color: 'var(--accent-amber)',
      fontSize: '0.75rem',
      fontWeight: '600',
      textTransform: 'uppercase',
      letterSpacing: '0.1em',
      marginBottom: '12px',
      borderBottom: '1px solid var(--border-subtle)',
      paddingBottom: '4px',
    },
    inputGroup: {
      marginBottom: '16px',
    },
    label: {
      display: 'block',
      color: 'var(--text-dim)',
      fontSize: '0.7rem',
      marginBottom: '6px',
      textTransform: 'uppercase',
    },
    input: {
      width: '100%',
      padding: '10px 12px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-primary)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      fontSize: '0.85rem',
      outline: 'none',
    },
    textarea: {
      width: '100%',
      padding: '10px 12px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-primary)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      fontSize: '0.85rem',
      outline: 'none',
      resize: 'vertical',
      minHeight: '60px',
      fontFamily: 'inherit',
    },
    select: {
      width: '100%',
      padding: '10px 12px',
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border-primary)',
      borderRadius: '4px',
      color: 'var(--text-primary)',
      fontSize: '0.85rem',
      outline: 'none',
      cursor: 'pointer',
    },
    colorGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
      gap: '12px',
    },
    checkbox: {
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      cursor: 'pointer',
    },
    checkboxInput: {
      width: '16px',
      height: '16px',
      accentColor: 'var(--accent-amber)',
    },
    checkboxLabel: {
      color: 'var(--text-secondary)',
      fontSize: '0.8rem',
    },
    preview: {
      marginTop: '16px',
      padding: '16px',
      borderRadius: '8px',
      border: '1px solid var(--border-primary)',
    },
    previewTitle: {
      color: 'var(--text-dim)',
      fontSize: '0.7rem',
      marginBottom: '12px',
      textTransform: 'uppercase',
    },
    previewBox: {
      padding: '16px',
      borderRadius: '6px',
    },
    previewWave: {
      padding: '12px',
      borderRadius: '4px',
      marginBottom: '8px',
    },
    previewPing: {
      padding: '8px 12px',
      borderRadius: '4px',
      marginBottom: '4px',
    },
    previewButtons: {
      display: 'flex',
      gap: '8px',
      marginTop: '12px',
    },
    previewButton: {
      padding: '6px 12px',
      borderRadius: '4px',
      border: 'none',
      cursor: 'pointer',
      fontSize: '0.75rem',
    },
    footer: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '16px',
      borderTop: '1px solid var(--border-primary)',
      flexShrink: 0,
    },
    footerButtons: {
      display: 'flex',
      gap: '8px',
    },
    btn: {
      padding: '8px 16px',
      borderRadius: '4px',
      border: 'none',
      cursor: 'pointer',
      fontSize: '0.8rem',
      fontWeight: '500',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    },
    btnPrimary: {
      backgroundColor: 'var(--accent-amber)',
      color: 'var(--bg-base)',
    },
    btnSecondary: {
      backgroundColor: 'var(--bg-surface)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-primary)',
    },
    importInput: {
      display: 'none',
    },
  };

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <h3 style={styles.title}>{isEditing ? 'Edit Theme' : 'Create Theme'}</h3>
        <div style={styles.headerButtons}>
          <label style={{ ...styles.btn, ...styles.btnSecondary, cursor: 'pointer' }}>
            Import
            <input
              type="file"
              accept=".json"
              onChange={handleImport}
              style={styles.importInput}
            />
          </label>
          <button
            onClick={handleExport}
            style={{ ...styles.btn, ...styles.btnSecondary }}
          >
            Export
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {/* Basic Info */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Theme Info</div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Custom Theme"
              maxLength={50}
              style={styles.input}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="A brief description of your theme..."
              maxLength={200}
              style={styles.textarea}
            />
          </div>

          <div style={styles.inputGroup}>
            <label style={styles.label}>Start From</label>
            <select
              value={baseTheme}
              onChange={(e) => loadFromBaseTheme(e.target.value)}
              style={styles.select}
            >
              {Object.entries(THEMES).map(([key, config]) => (
                <option key={key} value={key}>{config.name}</option>
              ))}
            </select>
          </div>

          <label style={styles.checkbox}>
            <input
              type="checkbox"
              checked={isPublic}
              onChange={(e) => setIsPublic(e.target.checked)}
              style={styles.checkboxInput}
            />
            <span style={styles.checkboxLabel}>Make this theme public (share with others)</span>
          </label>
        </div>

        {/* Color Sections */}
        {Object.entries(THEME_VARIABLE_GROUPS).map(([group, vars]) => (
          <div key={group} style={styles.section}>
            <div style={styles.sectionTitle}>{group}</div>
            <div style={styles.colorGrid}>
              {vars.map(({ key, label, description }) => (
                <ColorPicker
                  key={key}
                  value={variables[key]}
                  onChange={(value) => updateVariable(key, value)}
                  label={label}
                  description={description}
                />
              ))}
            </div>
          </div>
        ))}

        {/* Live Preview */}
        <div style={styles.section}>
          <div style={styles.sectionTitle}>Preview</div>
          <div
            style={{
              ...styles.previewBox,
              backgroundColor: variables['--bg-base'],
              border: `1px solid ${variables['--border-primary']}`,
            }}
          >
            <div
              style={{
                ...styles.previewWave,
                backgroundColor: variables['--bg-surface'],
                border: `1px solid ${variables['--border-subtle']}`,
              }}
            >
              <div style={{ color: variables['--text-primary'], fontSize: '0.9rem', marginBottom: '4px' }}>
                Sample {T.Wave} Title
              </div>
              <div style={{ color: variables['--text-muted'], fontSize: '0.7rem' }}>
                2 participants
              </div>
            </div>

            <div
              style={{
                ...styles.previewPing,
                backgroundColor: variables['--bg-elevated'],
                borderLeft: `3px solid ${variables['--accent-amber']}`,
              }}
            >
              <div style={{ color: variables['--accent-amber'], fontSize: '0.7rem', marginBottom: '2px' }}>
                @user
              </div>
              <div style={{ color: variables['--text-primary'], fontSize: '0.8rem' }}>
                This is a sample {T.ping} message.
              </div>
            </div>

            <div
              style={{
                ...styles.previewPing,
                backgroundColor: variables['--bg-surface'],
              }}
            >
              <div style={{ color: variables['--text-secondary'], fontSize: '0.7rem', marginBottom: '2px' }}>
                @another
              </div>
              <div style={{ color: variables['--text-secondary'], fontSize: '0.8rem' }}>
                A reply to the {T.ping} above.
              </div>
            </div>

            <div style={styles.previewButtons}>
              <button
                style={{
                  ...styles.previewButton,
                  backgroundColor: variables['--accent-amber'],
                  color: variables['--bg-base'],
                }}
              >
                Primary
              </button>
              <button
                style={{
                  ...styles.previewButton,
                  backgroundColor: variables['--status-error'],
                  color: '#fff',
                }}
              >
                Danger
              </button>
              <button
                style={{
                  ...styles.previewButton,
                  backgroundColor: variables['--bg-surface'],
                  color: variables['--text-primary'],
                  border: `1px solid ${variables['--border-primary']}`,
                }}
              >
                Secondary
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div style={styles.footer}>
        <button
          onClick={onCancel}
          style={{ ...styles.btn, ...styles.btnSecondary }}
          disabled={saving}
        >
          Cancel
        </button>
        <div style={styles.footerButtons}>
          <button
            onClick={handleSave}
            style={{ ...styles.btn, ...styles.btnPrimary }}
            disabled={saving || !name.trim()}
          >
            {saving ? <LoadingSpinner size={14} /> : null}
            {saving ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create Theme')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ThemeEditor;
