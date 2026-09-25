tryCatch(() => {
    'use strict';

    const PREFIX = '@cc$witch!';
    const AV_PREFIX = `${PREFIX}ava!`;
    const ACTIVE = '@cc@ctive!';
    const parse = raw => raw && tryCatch(() => JSON.parse(raw), false)();
    const isFreeSnap = s => (s && !s.p && !s.b && !s.pf) | 0;
    const logEvent = id => Promise.resolve(eventlog(id)).catch(nop);
    const gUACTell = (ex) => {

        // if no 'ex' was provided, the user canceled a [confirmation] dialog
        if (ex) {
            tell(ex);

            // @todo eventlog() ?
        }
    };

    const captureAvatar = async() => {

        await useravatar.loadAvatar(u_handle).catch(nop);

        const meta = generateAvatarMeta(u_handle);
        let avatar = {c: meta.color, s: meta.shortName};

        if (meta.avatarUrl) {

            const b64 = await new Promise(resolve => {
                const img = new Image();
                img.onerror = () => resolve(null);
                img.onload = () => resolve(tryCatch(() => {
                    const canvas = document.createElement('canvas');
                    canvas.width = canvas.height = 64;
                    canvas.getContext('2d').drawImage(img, 0, 0, 64, 64);
                    return canvas.toDataURL('image/webp');
                })());
                img.src = meta.avatarUrl;
            });

            if (b64) {
                await M.setPersistentData(AV_PREFIX + u_handle, b64).then(() => {
                    avatar = {img: 1};
                }).catch(dump);
            }
        }

        return avatar;
    };

    const captureCurrent = async() => {

        const session = {sid: u_storage.sid, k: u_storage.k};
        const {email, fullname: name, p, b, pf} = u_attr;
        const avatar = await captureAvatar();
        const snap = {handle: u_handle, email, name, ts: unixtime(), p, b, pf, avatar, session};

        u_storage.setItem(PREFIX + u_handle, JSON.stringify(snap));

        return snap;
    };

    const listSnapshots = () => {

        const out = [];

        for (let i = 0; i < u_storage.length; i++) {

            const k = u_storage.key(i);

            if (k && k.startsWith(PREFIX)) {

                const snap = parse(u_storage.getItem(k));

                if (snap && snap.handle && snap.handle !== u_handle) {
                    out.push(snap);
                }
            }
        }

        out.sort((a, b) => (b.ts | 0) - (a.ts | 0));

        return out;
    };

    const removeSnapshot = h => {
        u_storage.removeItem(PREFIX + h);
        M.delPersistentData(AV_PREFIX + h);
    };

    const clearAll = () => {

        localStorage.removeItem(ACTIVE);

        for (let i = u_storage.length; i--;) {

            const k = u_storage.key(i);

            if (k && k.startsWith(PREFIX)) {
                u_storage.removeItem(k);
            }
        }

        M.getPersistentDataEntries(AV_PREFIX).then(keys => {
            for (let i = 0; i < keys.length; i++) {
                M.delPersistentData(keys[i]);
            }
        }).catch(nop);
    };

    const applySessionAndReload = async(snap, msg) => {

        const {session, handle} = snap;
        const halt = [u_storage === sessionStorage, session.sid, session.k];

        await mega.halt('switch-session', halt);

        if (!self.fminitialized) {
            watchdog.notify('halt(switch-session)', halt);
        }

        if (!pfid && is_fm()) {
            pushHistoryState(true, 'fm');
        }

        u_logout();

        u_storage.k = session.k;
        u_storage.sid = session.sid;

        if (handle) {
            localStorage.setItem(ACTIVE, handle);
        }

        if (msg) {
            return msgDialog('info', '', msg, false, () => location.reload());
        }
        location.reload();
    };

    const isSessionAlive = async sid => {

        let res = await fetch(`${apipath}cs?`, {
            method: 'POST',
            body: '[{"a":"ug"}]',
            headers: {'MEGA-Chrome-Antileak': `/cs?id=0&sid=${sid}`}
        }).then(r => r.json());

        res = Array.isArray(res) ? res[0] : res;

        if (res < 0) {

            if (res === ESID || res === EBLOCKED) {
                return false;
            }
            throw new Error(res);
        }

        return res;
    };

    const restoreAndReload = async(handle) => {

        if (u_type < 3) {
            return;
        }

        const target = parse(u_storage.getItem(PREFIX + handle));

        if (!target || !target.session || !target.session.sid || !target.session.k ||
            !await isSessionAlive(target.session.sid)) {

            msgDialog('warninga', '', l.account_switch_session_unavailable);
            removeSnapshot(handle);
            buildSwitchAccountMenu();

            return;
        }

        await M.logoutAbortTransfers();

        await captureCurrent();
        return applySessionAndReload(target);
    };

    let setSV;

    const addAccount = async() => {

        if (u_type < 3) {
            return;
        }

        if (listSnapshots().length >= 4) {

            eventlog(501255);

            return msgDialog('warninga', '', l.account_switch_limit_reached.replace('%1', 5));
        }

        const snap = await captureCurrent();

        const reqFailed = self.api_reqfailed;
        const skipRsa = security.login.skipToGenerateRsaKeys;
        setSV = setSV || security.login.setSessionVariables;
        let captured = null;

        const onReqFailed = function(channel, error) {

            if (channel === 0 && (error | 0) === EBLOCKED) {
                return applySessionAndReload(snap, l.account_switch_account_blocked).catch(dump);
            }
            return reqFailed.call(this, channel, error);
        };

        self.api_reqfailed = onReqFailed;
        security.login.skipToGenerateRsaKeys = nop;
        security.login.setSessionVariables = data => {

            security.login.setSessionVariables = setSV;

            if (data === false) {
                return setSV.call(security.login, false);
            }

            captured = data;

            const cb = security.login.loginCompleteCallback;

            security.login.loginCompleteCallback = dump;

            if (cb) {
                cb(3);
            }

            return MegaPromise.resolve(3);
        };

        await mega.ui.login.showRequiredDialog({
            skipInitialDialog: 1,
            minUserType: 99,
            showRegister: false,
            notShowRememberMe: true,
            notShowForgotPass: true,
            clearAllInputs: true
        }).always(() => {
            self.api_reqfailed = reqFailed;
            security.login.skipToGenerateRsaKeys = skipRsa;
        });

        if (!captured) {
            return;
        }

        const acc = await isSessionAlive(captured[1]);

        if (!acc) {
            return msgDialog('warninga', '', l.account_switch_account_blocked);
        }

        await M.logoutAbortTransfers();
        await logEvent(501252);
        await applySessionAndReload({
            handle: acc.u,
            session: {sid: captured[1], k: JSON.stringify(captured[0])}
        });
    };

    const buildAvatar = (node, {img, c, s}) => {

        const wrap = mCreateElement('span', {class: 'left-icon switch-account-avatar'});

        if (img) {
            mCreateElement('img', {src: img}, wrap);
        }
        else {
            wrap.classList.add(`color${c || 1}`);
            wrap.textContent = s || '';
        }

        node.insertBefore(wrap, node.firstChild);
    };

    const removeFreeSnaps = freeSnaps => {
        for (let i = 0; i < freeSnaps.length; i++) {
            removeSnapshot(freeSnaps[i].handle);
        }
        buildSwitchAccountMenu();
    };

    let askPending = false;

    const enforceFreeLimit = async(ask, acc) => {

        // Clear orphaned avatars
        M.getPersistentDataEntries(AV_PREFIX).then(keys => {
            for (let i = 0; i < keys.length; i++) {
                if (!u_storage.getItem(PREFIX + keys[i].slice(AV_PREFIX.length))) {
                    M.delPersistentData(keys[i]);
                }
            }
        }).catch(nop);

        if (!isFreeSnap(u_attr) || page === 'pro' || String(page).startsWith('propay')) {
            return;
        }

        const freeSnaps = listSnapshots().filter(s => isFreeSnap(s));

        if (!freeSnaps.length) {
            return;
        }

        const plan = acc || await M.getAccountDetails();

        if (!isFreeSnap(plan)) {
            return;
        }

        if (askPending || $.msgDialog === 'switch-limit') {
            return;
        }

        if (!ask) {
            return removeFreeSnaps(freeSnaps);
        }

        const show = () => {

            if (!askPending) {
                return;
            }

            askPending = false;

            msgDialog(
                `switch-limit:!^${l.upgrade_now}!${mega.icu.format(l.account_switch_remove_free, freeSnaps.length)}`,
                '',
                l.account_switch_one_free_only,
                l.account_switch_one_free_only_sub,
                res => {
                    if (res) {
                        logEvent(501254).then(() => {
                            loadSubPage('pro');
                            location.reload(); // for remove fminit flag
                        });
                    }
                    else {
                        removeFreeSnaps(freeSnaps);
                    }
                }
            );
        };

        askPending = true;
        eventlog(501253);

        if (is_fm() && !fminitialized) {
            M.onFileManagerReady(show);
        }
        else {
            show();
        }
    };

    const onPlanChange = () => {

        if (u_type < 3) {
            return;
        }

        M.getAccountDetails().then(acc => {

            // Downgrade?
            if (isFreeSnap(u_attr)) {
                return enforceFreeLimit(true, acc);
            }

            askPending = false;

            if ($.msgDialog === 'switch-limit') {
                closeMsg();
            }
        }).catch(dump);
    };

    function buildSwitchAccountMenu(submenu, closeMenu, ask) {

        if (!submenu || !closeMenu) {
            const {switchAccount, closeAvatarMenu} = mega.ui.header;
            submenu = switchAccount && switchAccount.querySelector('.sub-menu');
            closeMenu = closeAvatarMenu;
        }

        if (!submenu) {
            return;
        }

        enforceFreeLimit(ask).catch(dump);

        submenu.textContent = '';

        const sessions = listSnapshots();
        const activeBtn = new MegaButton({
            parentNode: submenu,
            type: 'fullwidth',
            componentClassname: 'switch-account-session current',
            text: M.getNameByHandle(u_handle),
            subtext: u_attr.email,
            rightIcon: 'sprite-fm-mono icon-check-thin-outline',
            rightIconSize: 24
        });

        useravatar.loadAvatar(u_handle).catch(dump).finally(() => {

            const meta = generateAvatarMeta(u_handle);

            buildAvatar(activeBtn.domNode, {img: meta.avatarUrl, c: meta.color, s: meta.shortName});
        });

        for (let i = 0; i < sessions.length; i++) {

            const session = sessions[i];
            const accBtn = new MegaButton({
                parentNode: submenu,
                type: 'fullwidth',
                componentClassname: 'switch-account-session',
                text: session.name,
                subtext: session.email,
                rightIcon: 'sprite-fm-mono icon-trash-thin-outline switch-account-delete simpletip',
                rightIconSize: 24,
                onClick(e) {

                    if (this.disabled) {
                        return;
                    }

                    this.disabled = true;

                    if (e.target.closest('.switch-account-delete')) {

                        const title = l.account_switch_del_title.replace('$1', session.email);

                        msgDialog('confirmation', '', title, l.account_switch_del_desc, res => {
                            if (res) {
                                removeSnapshot(session.handle);
                                buildSwitchAccountMenu(submenu, closeMenu);
                            }
                            this.disabled = false;
                        });
                    }
                    else {
                        logEvent(501251)
                            .then(() => restoreAndReload(session.handle))
                            .catch(gUACTell)
                            .finally(() => {
                                this.disabled = false;
                            });
                    }
                }
            });

            accBtn.domNode.rightIcon.elm.dataset.simpletip = l[83];
            accBtn.domNode.rightIcon.elm.dataset.simpletipposition = 'top';
            accBtn.domNode.rightIcon.elm.dataset.simpletipwrapper = 'body';

            const av = session.avatar || {};

            if (av.img) {
                M.getPersistentData(AV_PREFIX + session.handle)
                    .then(b64 => buildAvatar(accBtn.domNode, {img: b64}))
                    .catch(() => buildAvatar(accBtn.domNode, {}));
            }
            else {
                buildAvatar(accBtn.domNode, {c: av.c, s: av.s});
            }
        }

        if (sessions.length < 4) {

            mCreateElement('div', {class: 'horizontal-divider'}, submenu);

            MegaButton.factory({
                parentNode: submenu,
                type: 'fullwidth',
                componentClassname: 'switch-account-add',
                icon: 'sprite-fm-mono icon-add-circle',
                text: l.add_account,
                onClick() {

                    if (this.disabled) {
                        return;
                    }

                    this.disabled = true;

                    closeMenu();
                    addAccount().catch(gUACTell).finally(() => {
                        this.disabled = false;
                    });
                }
            });
        }
    }

    mBroadcaster.addListener('logout', clearAll);
    mBroadcaster.once('startMega:desktop', () => {

        if (u_type < 3 || !u_handle) {
            return clearAll();
        }

        const active = localStorage.getItem(ACTIVE);

        if (!active) {
            localStorage.setItem(ACTIVE, u_handle);
        }
        else if (active !== u_handle) {

            const target = parse(u_storage.getItem(PREFIX + active));

            if (target && target.session && target.session.sid && target.session.k) {

                if (!pfid && is_fm()) {
                    pushHistoryState(true, 'fm');
                }

                u_storage.k = target.session.k;
                u_storage.sid = target.session.sid;
                location.reload();
            }
        }
    });

    Object.defineProperty(self, 'accountSwitcher', {
        value: freeze({
            buildSwitchAccountMenu,
            onPlanChange
        })
    });
})();
