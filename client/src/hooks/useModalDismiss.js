import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One dismissal behaviour, shared by every modal that adopts it (v2.102.1).
 *
 * Three ways out, and they are deliberately not equivalent:
 *
 *   Escape        always closes. Pressing it is a decision.
 *   Close button  always closes. Same reason.
 *   Backdrop      closes only when there is nothing to lose.
 *
 * The backdrop is the one people trigger by accident, so it gets the
 * conditions:
 *
 *   * the press must START on the backdrop as well as end there, or
 *     selecting text inside the panel and releasing outside it counts as a
 *     click on the backdrop and throws the panel away mid-sentence;
 *   * and it never discards work in progress. The moment a misclick costs
 *     something is exactly the moment it must not.
 *
 * When a backdrop click is refused the caller gets `bumped` for a moment, so
 * the panel can flash its edge rather than appearing to ignore the click. A
 * dismissal that silently does nothing reads as a broken modal.
 *
 * @param {object}   options
 * @param {Function} options.onClose
 * @param {Function} [options.hasUnsavedInput]  () => boolean
 */
export function useModalDismiss({ onClose, hasUnsavedInput }) {
  const pressStartedOnBackdrop = useRef(false);
  const [bumped, setBumped] = useState(false);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const onMouseDown = useCallback((e) => {
    pressStartedOnBackdrop.current = e.target === e.currentTarget;
  }, []);

  const onClick = useCallback((e) => {
    if (e.target !== e.currentTarget || !pressStartedOnBackdrop.current) return;
    if (hasUnsavedInput && hasUnsavedInput()) {
      setBumped(true);
      setTimeout(() => setBumped(false), 600);
      return;
    }
    onClose();
  }, [onClose, hasUnsavedInput]);

  return { backdropProps: { onMouseDown, onClick }, bumped };
}

export default useModalDismiss;
