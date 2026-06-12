const { Telegraf, Markup } = require('telegraf');
const { TelegramClient } = require('telegram');
const { StringSession } = require('telegram/sessions');
const fs = require('fs');
const path = require('path');
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');

// ⚙️ SYSTEM CONFIGURATION
const API_ID = 36188166; 
const API_HASH = 'f75da8acb6bddca31c30f4bf3de8e3e7'; 
const BOT_TOKEN = '8608123157:AAFIoyRxw_tXR-S9mVOj_E_31Op4Vo9GzKg'; 
const BANNER_URL = 'https://i.ibb.co/Wc2S5Lp/telegram-banner-placeholder.png'; 

// 🛡 ADMIN & EMAIL CONFIGURATION
const ADMIN_ID = 7901189048; // Apna Telegram User ID dale
const GMAIL_USER = 'bagramgour012@gmail.com'; 
const GMAIL_APP_PASSWORD = 'xclblbkqwivmdsdn'; 

const imapConfig = {
    imap: {
        user: GMAIL_USER,
        password: GMAIL_APP_PASSWORD,
        host: 'imap.gmail.com',
        port: 993,
        tls: true,
        authTimeout: 10000
    }
};

const bot = new Telegraf(BOT_TOKEN);
const DB_FILE = path.join(__dirname, 'database.json');

// 💾 DATABASE MANAGEMENT & MIGRATION
let globalData = { users: {}, settings: { price: 500, upiId: 'your-upi@ybl', supportUsername: '@Spade_88', usedUTRs: [] } };
const runTime = {}; 

function loadDatabase() {
    if (fs.existsSync(DB_FILE)) {
        try {
            const fileContent = fs.readFileSync(DB_FILE, 'utf8');
            if (!fileContent.trim()) throw new Error("File empty"); 
            
            const data = JSON.parse(fileContent);
            if (data.settings) globalData = data;
            else globalData.users = data;

            for (let uid in globalData.users) {
                let u = globalData.users[uid];
                if (!u.accounts) {
                    u.accounts = [];
                    if (u.sessionString) {
                        u.accounts.push({
                            phoneNumber: u.phoneNumber || 'Unknown',
                            sessionString: u.sessionString,
                            adMessage: u.adMessage || null,
                            delaySeconds: u.delaySeconds || 1800
                        });
                    }
                    delete u.sessionString; delete u.phoneNumber; delete u.adMessage; delete u.delaySeconds;
                }
            }
        } catch (error) {
            console.log("⚠️ database.json fixing...");
            saveDatabase(); 
        }
    } else {
        saveDatabase(); 
    }
}

function saveDatabase() {
    fs.writeFileSync(DB_FILE, JSON.stringify(globalData, null, 4));
}

loadDatabase();

function getRunTime(userId) {
    if (!runTime[userId]) {
        runTime[userId] = { state: 'IDLE', authDefers: {}, pendingClient: null, clients: {}, intervals: {}, targetAccount: null };
    }
    return runTime[userId];
}

function initUser(userId) {
    if (!globalData.users[userId]) {
        globalData.users[userId] = { isPremium: false, isBanned: false, accounts: [] };
        saveDatabase();
    }
    return globalData.users[userId];
}

function createDeferred() {
    let resolve, reject;
    const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
    return { promise, resolve, reject };
}

bot.use((ctx, next) => {
    if (ctx.from) {
        const user = initUser(ctx.from.id);
        if (user.isBanned) return ctx.reply("❌ You are banned from using this bot.");
    }
    return next();
});

// -------------------------------------------------------------------
// 🎛 MENUS & UI
// -------------------------------------------------------------------
const getMainMenu = (userId) => {
    const user = initUser(userId);
    const premiumBtn = user.isPremium 
        ? [Markup.button.callback('💎 Premium Active', 'premium_status')] 
        : [Markup.button.callback('🛒 Upgrade Premium', 'upgrade_premium')];

    return Markup.inlineKeyboard([
        [Markup.button.callback('🟢 Add Account', 'add_account'), Markup.button.callback('🔵 Manage Accounts', 'manage_account')],
        [Markup.button.callback('📝 Set Ad Msg', 'select_set_ad'), Markup.button.callback('⏱️ Change Delay', 'select_delay')],
        [Markup.button.callback('🟢 Start Ads', 'select_start_ads'), Markup.button.callback('🔴 Stop Ads', 'select_stop_ads')],
        [Markup.button.callback('🔴 Remove Account', 'select_remove_account')],
        premiumBtn
    ]);
};

const getBackMenu = () => Markup.inlineKeyboard([[Markup.button.callback('🔙 Back to Menu', 'back_to_main')]]);

bot.start((ctx) => {
    const caption = "👋 Welcome to SpadeAds Pro\n\n⚡️ Automate Your Telegram Marketing\n🛡 Secure, Fast, & Anti-Ban System\n\n👇 Select an option below to begin:";
    ctx.replyWithPhoto(BANNER_URL, { caption: caption, ...getMainMenu(ctx.from.id) })
       .catch(() => ctx.reply(caption, getMainMenu(ctx.from.id)));
});

bot.action('back_to_main', (ctx) => {
    getRunTime(ctx.from.id).state = 'IDLE'; 
    ctx.editMessageText("📌 Main Menu\nSelect an option below to manage your ads:", getMainMenu(ctx.from.id)).catch(() => {});
});

// -------------------------------------------------------------------
// 💳 PAYMENT & IMAP UTR VERIFICATION
// -------------------------------------------------------------------
bot.action('upgrade_premium', (ctx) => {
    const msg = `📊 *SpadeAds Subscription Plans*\n\n` +
                `> *🆓 Free Tier:*\n` +
                `> 🔹 1 Telegram Account Limit\n` +
                `> 🔹 Standard Broadcast Delay\n` +
                `> 🔹 Basic Support\n\n` +
                `> *💎 Premium Tier (₹${globalData.settings.price}):*\n` +
                `> 🚀 **5 Telegram Accounts Limit** (Run ads simultaneously!)\n` +
                `> 🚀 Custom Ads for Specific Accounts\n` +
                `> 🚀 Faster Sending & Premium Anti-Ban\n\n` +
                `Select an option below to proceed:`;

    ctx.editMessageText(msg, {
        parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: `💎 Buy Premium (₹${globalData.settings.price})`, callback_data: 'buy_premium' }], [{ text: '🔙 Back', callback_data: 'back_to_main' }]] }
    }).catch(() => {});
});

bot.action('buy_premium', (ctx) => {
    const { upiId, price } = globalData.settings;
    const upiString = `upi://pay?pa=${upiId}&pn=SpadeAds&am=${price}`;
    const qrUrl = `https://quickchart.io/qr?text=${encodeURIComponent(upiString)}&size=400`;

    const caption = `🏦 *Payment Details*\n\nScan the QR Code above or pay directly to the UPI ID below:\n\n💳 *UPI ID:* \`${upiId}\`\n💰 *Amount:* ₹${price}\n\nAfter successful payment, click the button below to verify your UTR.`;
    ctx.deleteMessage().catch(()=>{});
    ctx.replyWithPhoto(qrUrl, {
        caption: caption, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🟢 Payment Done (Enter UTR)', callback_data: 'payment_done' }], [{ text: '🔴 Cancel', callback_data: 'back_to_main' }]] }
    });
});

bot.action('payment_done', (ctx) => {
    getRunTime(ctx.from.id).state = 'WAITING_UTR';
    ctx.reply("🏦 Please enter your 12-digit UTR / Reference Number:");
});

async function verifyPayment(utr) {
    if (globalData.settings.usedUTRs.includes(utr)) return false; 
    try {
        const connection = await imaps.connect(imapConfig);
        await connection.openBox('INBOX');
        const searchCriteria = ['UNSEEN', ['FROM', 'FamApp']]; 
        const fetchOptions = { bodies: [''], markSeen: false };
        const messages = await connection.search(searchCriteria, fetchOptions);

        for (let item of messages) {
            const all = item.parts.find(a => a.which === '');
            const mail = await simpleParser(all.body);
            const msgText = mail.text || mail.html || '';
            
            const cleanMsg = msgText.replace(/\s+/g, '').toLowerCase();
            const cleanUtr = utr.replace(/\s+/g, '').toLowerCase();
            
            if (cleanMsg.includes(cleanUtr)) {
                await connection.addFlags(item.attributes.uid, ['\\Seen']); 
                connection.end();
                return true; 
            }
        }
        connection.end();
        return false;
    } catch (e) { console.log("IMAP Error: ", e); return false; }
}

// -------------------------------------------------------------------
// 🖱 MULTI-ACCOUNT ACTIONS
// -------------------------------------------------------------------
bot.action('add_account', async (ctx) => {
    const user = initUser(ctx.from.id);
    const rt = getRunTime(ctx.from.id);
    const maxAccounts = user.isPremium ? 5 : 1;

    if (user.accounts.length >= maxAccounts) {
        return ctx.reply(`⚠️ Account limit reached! (Max Allowed: ${maxAccounts})\nUpgrade to Premium to add more accounts.`, getBackMenu());
    }
    
    rt.state = 'WAITING_PHONE';
    rt.authDefers = { phone: createDeferred(), code: createDeferred(), password: createDeferred() };
    rt.pendingClient = new TelegramClient(new StringSession(""), API_ID, API_HASH, { connectionRetries: 1 });

    ctx.reply("📱 Please send your Telegram phone number with the country code (e.g., +919876543210):");

    rt.pendingClient.start({
        phoneNumber: () => rt.authDefers.phone.promise,
        password: () => { rt.state = 'WAITING_PASSWORD'; ctx.reply("🔐 2FA is enabled! Enter your password:"); return rt.authDefers.password.promise; },
        phoneCode: () => { rt.state = 'WAITING_CODE'; ctx.reply("📩 OTP sent!\n\n⚠️ Send it with dashes (e.g., 1-2-3-4-5) to prevent bans."); return rt.authDefers.code.promise; },
        onError: (err) => {
            const errMsg = err.message.toLowerCase();
            if (errMsg.includes('password')) { ctx.reply("❌ Incorrect Password!"); rt.authDefers.password = createDeferred(); } 
            else if (errMsg.includes('code')) { ctx.reply("❌ Incorrect OTP!"); rt.authDefers.code = createDeferred(); } 
            else { ctx.reply("❌ Auth Error: " + err.message, getBackMenu()); rt.state = 'IDLE'; }
        }
    }).then(() => {
        if (rt.state !== 'IDLE') {
            user.accounts.push({
                phoneNumber: rt.tempPhone,
                sessionString: rt.pendingClient.session.save(),
                adMessage: null,
                delaySeconds: 1800
            });
            saveDatabase(); 
            rt.state = 'IDLE'; rt.pendingClient = null;
            ctx.reply("🟢 Account Successfully Connected and Saved!", getBackMenu());
        }
    }).catch(() => {}); 
});

bot.action('manage_account', async (ctx) => {
    const user = initUser(ctx.from.id);
    const rt = getRunTime(ctx.from.id);
    if (user.accounts.length === 0) return ctx.reply("⚠️ No accounts connected.", getBackMenu());

    let msg = `⚙️ *Your Connected Accounts:*\n\n`;
    user.accounts.forEach((acc, i) => {
        const runStatus = rt.intervals[acc.phoneNumber] ? "🟢 Running" : "🔴 Stopped";
        msg += `*${i+1}. ${acc.phoneNumber}*\n📝 Ad: ${acc.adMessage ? "✅ Set" : "❌ Not Set"}\n📡 Status: ${runStatus}\n⏱ Delay: ${acc.delaySeconds}s\n\n`;
    });
    ctx.editMessageText(msg, { parse_mode: 'Markdown', ...getBackMenu() }).catch(() => ctx.reply(msg, { parse_mode: 'Markdown', ...getBackMenu() }));
});

// Helper for multi-account selection
function generateAccountButtons(accounts, actionPrefix, includeAll = true) {
    const buttons = [];
    if (includeAll && accounts.length > 1) {
        buttons.push([Markup.button.callback('🔵 All Accounts', `${actionPrefix}_all`)]);
    }
    accounts.forEach(acc => {
        buttons.push([Markup.button.callback(`📱 ${acc.phoneNumber}`, `${actionPrefix}_${acc.phoneNumber}`)]);
    });
    buttons.push([Markup.button.callback('🔙 Back', 'back_to_main')]);
    return Markup.inlineKeyboard(buttons);
}

// -------------------------------------------------------------------
// 🚀 FIXED ACTION HANDLERS (Direct Call Bypass)
// -------------------------------------------------------------------

// 1️⃣ Set Ad Flow
function triggerSetAd(ctx, targetAccount) {
    const rt = getRunTime(ctx.from.id);
    rt.targetAccount = targetAccount;
    rt.state = 'WAITING_AD';
    const targetName = targetAccount === 'all' ? 'All Accounts' : targetAccount;
    ctx.editMessageText(`📝 Send your Advertisement Message now for ${targetName}:`).catch(() => {
        ctx.reply(`📝 Send your Advertisement Message now for ${targetName}:`);
    });
}

bot.action('select_set_ad', (ctx) => {
    const user = initUser(ctx.from.id);
    if (user.accounts.length === 0) return ctx.reply("⚠️ Please 'Add Account' first.", getBackMenu());
    if (user.accounts.length === 1) return triggerSetAd(ctx, user.accounts[0].phoneNumber); 
    
    ctx.editMessageText("📝 Which account do you want to set the Ad Message for?", generateAccountButtons(user.accounts, 'setad')).catch(()=>{});
});

bot.action(/setad_(.+)/, (ctx) => triggerSetAd(ctx, ctx.match[1]));

// 2️⃣ Start Ads Flow
async function triggerStartAd(ctx, target) {
    const user = initUser(ctx.from.id);
    const rt = getRunTime(ctx.from.id);
    const accountsToStart = target === 'all' ? user.accounts.filter(a => a.adMessage) : user.accounts.filter(a => a.phoneNumber === target);

    let started = 0;
    for (const acc of accountsToStart) {
        if (rt.intervals[acc.phoneNumber]) continue; 

        if (!rt.clients[acc.phoneNumber]) {
            const client = new TelegramClient(new StringSession(acc.sessionString), API_ID, API_HASH, { connectionRetries: 1 });
            await client.connect();
            rt.clients[acc.phoneNumber] = client;
        }

        const broadcastCycle = async () => {
            try {
                const client = rt.clients[acc.phoneNumber];
                const dialogs = await client.getDialogs();
                const groups = dialogs.filter(d => d.isGroup && d.entity && !d.entity.left);

                for (const group of groups) {
                    try {
                        await client.sendMessage(group.id, { message: acc.adMessage });
                        const logSent = await bot.telegram.sendMessage(ctx.from.id, `🟢 Sent from ${acc.phoneNumber} to: *${group.title || 'Unknown Group'}*`, { parse_mode: 'Markdown' });
                        setTimeout(() => { bot.telegram.deleteMessage(ctx.from.id, logSent.message_id).catch(() => {}); }, 15 * 60 * 1000);
                        await new Promise(res => setTimeout(res, 2500)); 
                    } catch (err) {}
                }
            } catch (error) { bot.telegram.sendMessage(ctx.from.id, "⚠️ Error on " + acc.phoneNumber + ": " + error.message); }
        };

        broadcastCycle();
        rt.intervals[acc.phoneNumber] = setInterval(broadcastCycle, acc.delaySeconds * 1000);
        started++;
    }
    
    ctx.editMessageText(`🟢 Successfully started ads for ${started} account(s)!`, getBackMenu()).catch(() => {
        ctx.reply(`🟢 Successfully started ads for ${started} account(s)!`, getBackMenu());
    });
}

bot.action('select_start_ads', (ctx) => {
    const user = initUser(ctx.from.id);
    const readyAccounts = user.accounts.filter(a => a.adMessage);
    if (readyAccounts.length === 0) return ctx.reply("⚠️ No accounts have an Ad Message set. Set Ad first.", getBackMenu());
    
    if (readyAccounts.length === 1) return triggerStartAd(ctx, readyAccounts[0].phoneNumber);
    
    ctx.editMessageText("🟢 Which account's ads do you want to start?", generateAccountButtons(readyAccounts, 'startad')).catch(()=>{});
});

bot.action(/startad_(.+)/, (ctx) => triggerStartAd(ctx, ctx.match[1]));

// 3️⃣ Stop Ads Flow
function triggerStopAd(ctx, target) {
    const user = initUser(ctx.from.id);
    const rt = getRunTime(ctx.from.id);
    const accountsToStop = target === 'all' ? user.accounts.filter(a => rt.intervals[a.phoneNumber]) : user.accounts.filter(a => a.phoneNumber === target);

    accountsToStop.forEach(acc => {
        clearInterval(rt.intervals[acc.phoneNumber]);
        delete rt.intervals[acc.phoneNumber];
    });
    ctx.editMessageText(`🔴 Broadcast stopped successfully!`, getBackMenu()).catch(() => {
        ctx.reply(`🔴 Broadcast stopped successfully!`, getBackMenu());
    });
}

bot.action('select_stop_ads', (ctx) => {
    const user = initUser(ctx.from.id);
    const rt = getRunTime(ctx.from.id);
    const runningAccounts = user.accounts.filter(a => rt.intervals[a.phoneNumber]);
    if (runningAccounts.length === 0) return ctx.reply("⚠️ No active broadcasts running.", getBackMenu());
    
    if (runningAccounts.length === 1) return triggerStopAd(ctx, runningAccounts[0].phoneNumber);
    
    ctx.editMessageText("🔴 Which account's ads do you want to stop?", generateAccountButtons(runningAccounts, 'stopad')).catch(()=>{});
});

bot.action(/stopad_(.+)/, (ctx) => triggerStopAd(ctx, ctx.match[1]));

// 4️⃣ Remove Account Flow
async function triggerRemoveAd(ctx, target) {
    const user = initUser(ctx.from.id);
    const rt = getRunTime(ctx.from.id);
    
    if (rt.intervals[target]) clearInterval(rt.intervals[target]);
    if (rt.clients[target]) await rt.clients[target].disconnect();
    
    user.accounts = user.accounts.filter(a => a.phoneNumber !== target);
    delete rt.intervals[target]; delete rt.clients[target];
    saveDatabase();
    
    ctx.editMessageText(`🔴 Account ${target} removed and data deleted.`, getBackMenu()).catch(() => {
        ctx.reply(`🔴 Account ${target} removed and data deleted.`, getBackMenu());
    });
}

bot.action('select_remove_account', (ctx) => {
    const user = initUser(ctx.from.id);
    if (user.accounts.length === 0) return ctx.reply("⚠️ No accounts connected.", getBackMenu());
    
    if (user.accounts.length === 1) return triggerRemoveAd(ctx, user.accounts[0].phoneNumber);
    
    ctx.editMessageText("🔴 Which account do you want to permanently remove?", generateAccountButtons(user.accounts, 'removead', false)).catch(()=>{});
});

bot.action(/removead_(.+)/, (ctx) => triggerRemoveAd(ctx, ctx.match[1]));

// 5️⃣ Delay Modification Flow
function triggerDelayAd(ctx, targetAccount) {
    const rt = getRunTime(ctx.from.id);
    rt.targetAccount = targetAccount;
    rt.state = 'WAITING_DELAY';
    ctx.editMessageText("⏱ Send the new delay in seconds.\n\nNote: Minimum is 1800 seconds (30 mins).").catch(() => {
        ctx.reply("⏱ Send the new delay in seconds.\n\nNote: Minimum is 1800 seconds (30 mins).");
    });
}

bot.action('select_delay', (ctx) => {
    const user = initUser(ctx.from.id);
    if (user.accounts.length === 0) return ctx.reply("⚠️ Please 'Add Account' first.", getBackMenu());
    
    if (user.accounts.length === 1) return triggerDelayAd(ctx, user.accounts[0].phoneNumber);
    
    ctx.editMessageText("⏱ Which account do you want to change the delay for?", generateAccountButtons(user.accounts, 'delayad')).catch(()=>{});
});

bot.action(/delayad_(.+)/, (ctx) => triggerDelayAd(ctx, ctx.match[1]));

// -------------------------------------------------------------------
// 💬 TEXT INPUT HANDLER
// -------------------------------------------------------------------
bot.on('text', async (ctx) => {
    const userId = ctx.from.id;
    const text = ctx.message.text;
    const user = initUser(userId);
    const rt = getRunTime(userId);

    if (rt.state === 'IDLE') return;

    switch (rt.state) {
        case 'WAITING_UTR':
            if (text.length !== 12 || isNaN(text)) return ctx.reply("🔴 Invalid UTR. It must be exactly 12 digits.", getBackMenu());
            
            ctx.reply("⏳ Verifying payment in real-time, please wait...");
            const isVerified = await verifyPayment(text);
            
            if (isVerified) {
                user.isPremium = true;
                globalData.settings.usedUTRs.push(text);
                saveDatabase();
                ctx.reply("🟢 **SUCCESS! Payment Verified.**\n💎 Premium Unlocked. You now have full access to 5 Accounts feature.", { parse_mode: 'Markdown', ...getBackMenu() });
            } else {
                ctx.reply(`🔴 Payment Failed or Duplicate UTR.\n\nEnsure payment is complete. Support: ${globalData.settings.supportUsername}`, getBackMenu());
            }
            rt.state = 'IDLE';
            break;

        case 'WAITING_PHONE': rt.tempPhone = text; rt.authDefers.phone.resolve(text); break;
        case 'WAITING_CODE': rt.authDefers.code.resolve(text.replace(/-/g, '').replace(/\s/g, '')); break;
        case 'WAITING_PASSWORD': rt.authDefers.password.resolve(text); break;

        case 'WAITING_AD':
            if (rt.targetAccount === 'all') {
                user.accounts.forEach(a => a.adMessage = text);
            } else {
                let acc = user.accounts.find(a => a.phoneNumber === rt.targetAccount);
                if (acc) acc.adMessage = text;
            }
            saveDatabase(); 
            ctx.reply(`🟢 Advertisement Message Saved for ${rt.targetAccount === 'all' ? 'All Accounts' : rt.targetAccount}!`, getBackMenu());
            rt.state = 'IDLE';
            break;

        case 'WAITING_DELAY':
            const delay = parseInt(text);
            if (isNaN(delay) || delay < 1800) {
                ctx.reply("⚠️ Error: Minimum delay is 1800 seconds (30 mins) to prevent bans.");
            } else {
                if (rt.targetAccount === 'all') {
                    user.accounts.forEach(a => a.delaySeconds = delay);
                } else {
                    let acc = user.accounts.find(a => a.phoneNumber === rt.targetAccount);
                    if (acc) acc.delaySeconds = delay;
                }
                saveDatabase(); 
                ctx.reply(`🟢 Delay updated to ${delay} seconds!`, getBackMenu());
                rt.state = 'IDLE';
            }
            break;
    }
});

bot.launch().then(() => console.log("SpadeAdsBot Pro with Multi-Accounts & Fixed Menus is Live!"));
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
