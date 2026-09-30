/**
 * Reusable anchored dropdown list.
 *
 * Opens a keyboard-navigable list beneath (or above) an anchor(target) node.
 * Generic across the project: pass any "items" and, optionally, a "render(item)"
 * callback for custom rows. The default renderer understands contact-shaped
 * items ({name, email|id, handle}) and draws an avatar + name + email.
 *
 * @example
 * const dd = new MegaAnchoredDropdown({parentNode});
 * dd.on('select', item => ...);
 * dd.show({target: anchorNode, items});
 * // keyboard, driven by the host input: dd.selectNext()/selectPrev()/confirm()
 *
 * Events: "select" (the chosen item).
 */
// TODO: merge with pwn dropdown component
class MegaAnchoredDropdown extends MegaComponent {

    constructor(options) {
        super(options);

        this.options = options || {};

        const ce = this.ce = (n, t, a) => mCreateElement(n, a, t);

        this.items = [];
        this.rows = [];
        this.selected = -1;

        // Optional custom row renderer: (item, index) => HTMLElement | string.
        this._render = typeof this.options.render === 'function' ? this.options.render : null;
        this._outside = null;
        this._anchor = null;

        this.domNode.classList.add('dropdown', 'hidden');
        this.body = ce('div', this.domNode, {class: 'dropdown-body'});
        this.list = ce('div', this.body, {class: 'dropdown-list'});

        if (this.options.showCheck) {
            this.domNode.classList.add('show-check');
        }

        // Select mode: build a <select>-like trigger
        if (this.options.select) {
            this._buildSelect(this.options);
        }
    }

    /**
     * Open the dropdown under "target" with the given "items"
     * @param {Object} options Dropdown options
     * @param {HTMLElement|MegaComponent} [options.target] Anchor to align to
     * @param {Array} [options.items] Items to list
     * @param {Function} [options.render] Per-call row renderer override
     * @returns {void}
     */
    show(options = {}) {
        const {
            target = this.parentNode,
            items = [],
            render,
            position = this.options.position
        } = options;

        if (!items.length) {
            this.hide();
            return;
        }

        if (typeof render === 'function') {
            this._render = render;
        }

        this.items = items;
        this.selected = -1;

        this.render();

        this.removeClass('hidden');


        this._position(target, position);
        this._bindOutside(target);
    }

    hide() {
        this.items = [];
        this.rows = [];
        this.selected = -1;

        this.list.textContent = '';

        this.addClass('hidden');

        this._unbindOutside();
    }

    render() {
        this.list.textContent = '';
        this.rows = [];

        for (let i = 0; i < this.items.length; i++) {
            this.rows.push(this._renderRow(this.items[i], i));
        }
    }

    /**
     * Move the highlight down one row
     * @returns {void}
     */
    selectNext() {
        this._setSelected(Math.min(this.items.length - 1, this.selected + 1));
    }

    /**
     * Move the highlight up one row
     * @returns {void}
     */
    selectPrev() {
        this._setSelected(Math.max(0, this.selected - 1));
    }

    /**
     * Select the currently highlighted item
     * @returns {Boolean} True if an item was confirmed
     */
    confirm() {
        if (this.selected < 0 || this.selected >= this.items.length) {
            return false;
        }

        this.trigger('select', this.items[this.selected]);
        return true;
    }

    /**
     * Build the select-like button and set selected value
     * @param {Object} options "items" to list and optional initial "value"
     * @returns {void}
     */
    _buildSelect(options) {
        const {ce} = this;

        this.selectItems = options.items || [];

        const className = options.selectClassname;
        const suffix = className ? ` ${className}` : '';

        this.triggerNode = ce('button', null, {
            class: `dropdown-trigger${suffix}`,
            type: 'button'
        });

        this.parentNode.insertBefore(this.triggerNode, this.domNode);

        this.triggerIcon = ce('i', this.triggerNode, {class: 'trigger-icon'});
        this.triggerLabel = ce('span', this.triggerNode, {class: 'trigger-label'});
        ce('i', this.triggerNode, {
            class: `trigger-arrow ${mega.ui.sprites.mono} icon-chevron-down-thin-outline`
        });

        // Ignore keyboard generated clicks, they are handled separately
        this.triggerNode.addEventListener('click', e => {
            if (e.detail !== 0) {
                this.toggle();
            }
        });

        this.triggerNode.addEventListener('keydown', e => this._onTriggerKeyDown(e));

        // Set the chosen item in the trigger
        this.on('select', (ev, item) => this.setValue(item.id));

        const initial = options.value === undefined
            ? this.selectItems[0] && this.selectItems[0].id
            : options.value;

        this.setValue(initial);
    }

    /**
     * Open the panel under the trigger, or close it if already open
     * @returns {void}
     */
    toggle() {
        if (this.visible) {
            this.hide();
        }
        else {
            this._open();
        }
    }

    /**
     * Open the panel and highlight the current value (or the first item)
     * @returns {void}
     */
    _open() {
        this.show({target: this.triggerNode, items: this.selectItems});

        const index = this.selectItems.findIndex(i => i.id === this.value);

        this._setSelected(Math.max(index, 0));
    }

    /**
     * Keys control for the select trigger
     * Open/close, move the highlight, and confirm
     * @param {KeyboardEvent} e Event
     * @returns {void}
     */
    _onTriggerKeyDown(e) {
        const open = this.visible;

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                if (open) {
                    this.selectNext();
                }
                else {
                    this._open();
                }
                break;

            case 'ArrowUp':
                e.preventDefault();
                if (open) {
                    this.selectPrev();
                }
                else {
                    this._open();
                }
                break;

            case 'Enter':
            case ' ':
                e.preventDefault();
                if (open) {
                    if (!this.confirm()) {
                        this.hide();
                    }
                }
                else {
                    this._open();
                }
                break;

            case 'Escape':
                if (open) {
                    e.preventDefault();
                    this.hide();
                }
                break;

            case 'Tab':
                if (open) {
                    this.hide();
                }
                break;
        }
    }

    /**
     * Select an item by id (select mode) and update the trigger
     * @param {String} id Item id to select
     * @returns {void}
     */
    setValue(id) {
        const item = this.selectItems.find(i => i.id === id) || this.selectItems[0];

        if (!item) {
            return;
        }

        this.value = item.id;
        this.selectedItem = item;

        this.triggerLabel.textContent = item.name || item.label || item.id;

        this.triggerIcon.className = `trigger-icon ${item.icon || ''}`.trim();
        this.triggerIcon.classList.toggle('hidden', !item.icon);

        this.hide();
    }

    getValue() {
        return this.value;
    }

    _setSelected(index) {
        if (this.rows[this.selected]) {
            this.rows[this.selected].classList.remove(
                'active', 'sprite-fm-mono-after', 'icon-check-thin-outline-after'
            );
        }

        this.selected = index >= 0 && index < this.items.length ? index : -1;

        const row = this.rows[this.selected];

        if (row) {
            row.classList.add('active');

            if (this.options.showCheck) {
                row.classList.add(`${mega.ui.sprites.mono}-after`, 'icon-check-thin-outline-after');
            }

            row.scrollIntoView({block: 'nearest'});
        }
    }

    _renderRow(item, index) {
        const {ce} = this;
        const row = ce('div', this.list, {class: 'dropdown-item'});

        if (this._render) {
            const content = this._render(item, index);

            if (content instanceof Node) {
                row.appendChild(content);
            }
            else if (typeof content === 'string') {
                row.textContent = content;
            }
        }
        else {
            this._renderDefaultRow(row, item);
        }

        row.addEventListener('mousedown', e => {
            // Prevent the anchor input from blurring before we set the choice
            e.preventDefault();
            this._setSelected(index);
            this.trigger('select', item);
        });

        row.addEventListener('mouseenter', () => this._setSelected(index));

        return row;
    }

    _renderDefaultRow(row, item) {
        const {ce} = this;
        const handle = item.userHandle || item.handle;

        if (item.icon) {
            ce('i', ce('div', row, {class: 'dropdown-item-icon'}), {class: item.icon});
        }
        else if (item.avatar instanceof Node) {
            ce('div', row, {class: 'dropdown-item-avatar'}).appendChild(item.avatar);
        }
        else if (handle && typeof MegaAvatarComponent !== 'undefined') {
            MegaAvatarComponent.factory({
                parentNode: ce('div', row, {class: 'dropdown-item-avatar'}),
                userHandle: handle,
                size: 24
            });
        }

        const body = ce('div', row, {class: 'dropdown-item-body'});
        const name = item.name || item.label || item.email || item.id || '';

        ce('span', body, {class: 'dropdown-item-name'}).textContent = name;

        // Secondary line only for an explicit sub or an email-like value, so
        // permission ids such as "read-only" don't leak into the row.
        const sub = item.sub || item.email || (item.id && item.id.includes('@') ? item.id : '');

        if (sub && sub !== name) {
            ce('span', body, {class: 'dropdown-item-sub'}).textContent = sub;
        }
    }

    /**
     * Position the panel against the target
     * @param {HTMLElement|MegaComponent} target To which we are positioning
     * @param {String} position "left", "right" sides; "attached" -  combined UI with target
     * @returns {void}
     */
    _position(target, position) {
        const anchor = target && target.domNode || target;

        if (!anchor) {
            return;
        }

        const rect = anchor.getBoundingClientRect();
        const {
            bottom,
            top: rectTop,
            right,
            left: rectLeft,
            height: rectHeight,
            width: rectWidth
        } = rect;
        const {innerHeight} = window;
        const {style} = this.domNode;
        const isAttached = position === 'attached';
        const isRtl = document.body.classList.contains('rtl');
        const OFFSET = 4;

        if (isAttached) {
            anchor.classList.add('dropdown-attached');
            style.paddingTop = `${rectHeight + OFFSET}px`;
        }
        else {
            anchor.classList.remove('dropdown-attached');
            style.paddingTop = '';
        }

        const {offsetHeight: height, offsetWidth: width} = this.domNode;
        let left = rectLeft;
        let top;

        if (isAttached) {
            left -= OFFSET;
            top = rectTop - OFFSET;
            style.width = `${rectWidth + OFFSET * 2}px`;
        }
        else {
            style.width = '';

            const below = innerHeight - bottom;
            const above = rectTop;

            if (below >= height + OFFSET) {
                top = bottom + OFFSET;
            }
            else if (above >= height + OFFSET) {
                top = rectTop - height - OFFSET;
            }
            else {
                top = Math.max(
                    OFFSET,
                    Math.min(bottom + OFFSET, innerHeight - height - OFFSET)
                );
            }

            const attachRight = position === 'right' !== isRtl;

            left = attachRight ? right - width : rectLeft;
        }

        const transformedParent = this._getTransformedParent();

        if (transformedParent) {
            const parentRect = transformedParent.getBoundingClientRect();

            left -= parentRect.left;
            top -= parentRect.top;
        }

        style.left = `${left}px`;
        style.top = `${top}px`;
    }

    _getTransformedParent() {
        let parent = this.domNode.parentNode;

        while (parent && parent !== document.body) {
            if (getComputedStyle(parent).transform !== 'none') {
                return parent;
            }

            parent = parent.parentNode;
        }

        return null;
    }

    _bindOutside(target) {
        this._anchor = target && target.domNode || target || null;

        if (this._outside) {
            return;
        }

        this._outside = e => {
            if (this.domNode.contains(e.target)) {
                return;
            }

            if (this._anchor && this._anchor.contains(e.target)) {
                return;
            }

            this.hide();
        };

        document.addEventListener('pointerdown', this._outside, true);
    }

    _unbindOutside() {
        if (this._outside) {
            document.removeEventListener('pointerdown', this._outside, true);
            this._outside = null;
        }

        this._anchor = null;
    }

    destroy() {
        this._unbindOutside();

        if (this.triggerNode) {
            this.triggerNode.remove();
        }

        super.destroy();
    }
}
