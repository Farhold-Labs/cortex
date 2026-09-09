import React, { useState } from 'react';
import { GlowText } from '../ui/SimpleComponents.jsx';
import { formatError, CONFIRM_DIALOG } from '../../../messages.js';
import { T } from '../../config/terminology.js';

const CategoryManagementModal = ({ isOpen, onClose, categories, fetchAPI, showToast, onCategoriesChange, isMobile }) => {
  const [editingCategory, setEditingCategory] = useState(null);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryColor, setNewCategoryColor] = useState('var(--accent-green)');

  const colorOptions = [
    { label: 'Green', value: 'var(--accent-green)' },
    { label: 'Amber', value: 'var(--accent-amber)' },
    { label: 'Orange', value: 'var(--accent-orange)' },
    { label: 'Teal', value: 'var(--accent-teal)' },
    { label: 'Purple', value: 'var(--accent-purple)' },
  ];

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) {
      showToast('Category name is required', 'error');
      return;
    }

    try {
      const data = await fetchAPI('/wave-categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: {
          name: newCategoryName.trim(),
          color: newCategoryColor,
        },
      });

      showToast('Category created successfully', 'success');
      setNewCategoryName('');
      setNewCategoryColor('var(--accent-green)');
      onCategoriesChange();
    } catch (error) {
      showToast(error.message || formatError('Failed to create category'), 'error');
    }
  };

  const handleUpdateCategory = async (categoryId, updates) => {
    try {
      await fetchAPI(`/wave-categories/${categoryId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: updates,
      });

      showToast('Category updated successfully', 'success');
      setEditingCategory(null);
      onCategoriesChange();
    } catch (error) {
      showToast(error.message || formatError('Failed to update category'), 'error');
    }
  };

  const handleDeleteCategory = async (categoryId) => {
    if (!confirm(CONFIRM_DIALOG.deleteCategory)) {
      return;
    }

    try {
      await fetchAPI(`/wave-categories/${categoryId}`, {
        method: 'DELETE',
      });

      showToast('Category deleted successfully', 'success');
      onCategoriesChange();
    } catch (error) {
      showToast(error.message || formatError('Failed to delete category'), 'error');
    }
  };

  const handleReorderCategory = async (categoryIndex, direction) => {
    const newIndex = direction === 'up' ? categoryIndex - 1 : categoryIndex + 1;
    if (newIndex < 0 || newIndex >= categories.length) return;

    // Create reordered array
    const reordered = [...categories];
    const [moved] = reordered.splice(categoryIndex, 1);
    reordered.splice(newIndex, 0, moved);

    // Create categories array with new sortOrder values
    const reorderedCategories = reordered.map((cat, index) => ({
      id: cat.id,
      sortOrder: index,
    }));

    try {
      await fetchAPI('/wave-categories/reorder', {
        method: 'PUT',
        body: { categories: reorderedCategories },
      });

      showToast('Categories reordered successfully', 'success');
      onCategoriesChange();
    } catch (error) {
      console.error('Error reordering categories:', error);
      showToast(error.message || formatError('Failed to reorder categories'), 'error');
    }
  };

  if (!isOpen) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.85)', display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 10000, padding: isMobile ? '16px' : '20px',
    }} onClick={onClose}>
      <div style={{
        background: 'var(--bg-elevated)', border: '1px solid var(--accent-green)',
        borderRadius: '4px', padding: isMobile ? '20px' : '28px',
        maxWidth: '600px', width: '100%', maxHeight: '85vh', overflow: 'auto',
        boxShadow: '0 0 30px var(--glow-green)',
      }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
          <GlowText color="var(--accent-green)" size="1.2rem">MANAGE CATEGORIES</GlowText>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--text-dim)',
            cursor: 'pointer', fontSize: '1.5rem', padding: '4px 8px',
          }}>×</button>
        </div>

        {/* Create New Category */}
        <div style={{
          padding: '16px', background: 'var(--bg-hover)',
          border: '1px solid var(--border-subtle)', borderRadius: '4px', marginBottom: '24px',
        }}>
          <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '12px', fontSize: '0.9rem' }}>
            Create New Category
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <input
              type="text"
              placeholder="Category name (e.g., Work, Personal)"
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              maxLength={50}
              style={{
                padding: '10px', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                border: '1px solid var(--border-primary)', borderRadius: '4px',
                fontFamily: 'monospace', fontSize: '0.85rem',
              }}
            />
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {colorOptions.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setNewCategoryColor(opt.value)}
                  style={{
                    padding: '8px 12px', background: newCategoryColor === opt.value ? `${opt.value}30` : 'transparent',
                    border: `2px solid ${opt.value}`,
                    color: opt.value, cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.75rem',
                    borderRadius: '4px',
                  }}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <button
              onClick={handleCreateCategory}
              style={{
                padding: '10px', background: 'var(--accent-green)20',
                border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
                cursor: 'pointer', fontFamily: 'monospace', fontSize: '0.85rem', borderRadius: '4px',
              }}
            >
              + CREATE
            </button>
          </div>
        </div>

        {/* Existing Categories */}
        <div style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: '12px', fontSize: '0.9rem' }}>
          Your Categories ({categories.length})
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {categories.map((category, index) => (
            <div
              key={category.id}
              style={{
                padding: '14px', background: 'var(--bg-hover)',
                border: `1px solid ${category.color}40`, borderRadius: '4px',
                borderLeft: `4px solid ${category.color}`,
              }}
            >
              {editingCategory === category.id ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <input
                    type="text"
                    defaultValue={category.name}
                    onBlur={(e) => {
                      if (e.target.value.trim() && e.target.value !== category.name) {
                        handleUpdateCategory(category.id, { name: e.target.value.trim() });
                      } else {
                        setEditingCategory(null);
                      }
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.target.blur();
                      } else if (e.key === 'Escape') {
                        setEditingCategory(null);
                      }
                    }}
                    autoFocus
                    maxLength={50}
                    style={{
                      padding: '8px', background: 'var(--bg-primary)', color: 'var(--text-primary)',
                      border: '1px solid var(--border-primary)', borderRadius: '4px',
                      fontFamily: 'monospace', fontSize: '0.85rem',
                    }}
                  />
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1 }}>
                    <span style={{ color: category.color, fontSize: '1.2rem' }}>●</span>
                    <div>
                      <div style={{ color: 'var(--text-primary)', fontSize: '0.9rem', fontWeight: 500 }}>
                        {category.name}
                      </div>
                      <div style={{ color: 'var(--text-dim)', fontSize: '0.7rem', fontFamily: 'monospace' }}>
                        {category.waveCount} wave{category.waveCount !== 1 ? 's' : ''}
                        {category.unreadCount > 0 && ` • ${category.unreadCount} unread`}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                      onClick={() => handleReorderCategory(index, 'up')}
                      disabled={index === 0}
                      title="Move up"
                      style={{
                        background: 'transparent', border: 'none',
                        color: index === 0 ? 'var(--border-subtle)' : 'var(--text-dim)',
                        cursor: index === 0 ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem', padding: '4px 8px',
                      }}
                    >
                      ▲
                    </button>
                    <button
                      onClick={() => handleReorderCategory(index, 'down')}
                      disabled={index === categories.length - 1}
                      title="Move down"
                      style={{
                        background: 'transparent', border: 'none',
                        color: index === categories.length - 1 ? 'var(--border-subtle)' : 'var(--text-dim)',
                        cursor: index === categories.length - 1 ? 'not-allowed' : 'pointer',
                        fontSize: '0.9rem', padding: '4px 8px',
                      }}
                    >
                      ▼
                    </button>
                    <button
                      onClick={() => setEditingCategory(category.id)}
                      title="Rename category"
                      style={{
                        background: 'transparent', border: 'none', color: 'var(--text-dim)',
                        cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px',
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      onClick={() => handleDeleteCategory(category.id)}
                      title="Delete category"
                      style={{
                        background: 'transparent', border: 'none', color: 'var(--text-dim)',
                        cursor: 'pointer', fontSize: '0.9rem', padding: '4px 8px',
                      }}
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
          {categories.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
              No categories yet. Create one above to get started!
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CategoryManagementModal;
