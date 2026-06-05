--[[
    RoBl AI - Roblox Studio Plugin
    Connects to the RoBl web app to fetch and insert AI-generated Lua code.
    
    INSTALLATION:
    1. Open Roblox Studio
    2. Go to Plugins → Plugin Manager → "Add from Folder"
    3. Select the "plugin" folder containing this file
    4. The plugin toolbar button "RoBl AI" will appear
    
    Or copy this file to:
      Windows: %LOCALAPPDATA%\Roblox\Plugins\
      Mac:     ~/Library/Roblox/Plugins/
]]

local HttpService = game:GetService("HttpService")
local CoreGui = game:GetService("CoreGui")

-- ============ CONFIG ============
local API_URL = "https://robl-t4dq.onrender.com"
local API_BASE = API_URL .. "/api"
local POLL_INTERVAL = 5

local robloxId = nil
local isConnected = false
local pluginGui = nil
local pollingThread = nil

-- ============ TOOLBAR ============
local toolbar = plugin:CreateToolbar("RoBl AI")
local mainButton = toolbar:CreateButton("RoBlAI", "Open RoBl AI Panel", "")
mainButton.ClickableWhenViewportHidden = true

-- ============ HELPERS ============

local function log(msg, type)
    local prefix = "[RoBl] "
    if type == "error" then
        warn(prefix .. tostring(msg))
    elseif type == "success" then
        print(prefix .. tostring(msg))
    else
        print(prefix .. tostring(msg))
    end
end

local function httpGet(endpoint)
    local ok, result = pcall(function()
        return HttpService:GetAsync(API_BASE .. endpoint)
    end)
    if ok then
        return HttpService:JSONDecode(result)
    end
    return nil
end

local function openWebsite()
    -- Opens the RoBl web app in the user's default browser
    -- Uses Studio's built-in URL opening
    local ok = pcall(function()
        local url = API_URL
        -- Try to open URL via Studio's mechanism
        local success = pcall(function()
            plugin:OpenScriptUrl(url)
        end)
        if not success then
            log("Open " .. url .. " in your browser to get started")
        end
    end)
end

-- ============ CODE MANAGEMENT ============

local function insertCode(code, scriptType)
    local parent = game:GetService("ServerScriptService")
    local newScript

    if scriptType == "LocalScript" then
        newScript = Instance.new("LocalScript")
    elseif scriptType == "ModuleScript" then
        newScript = Instance.new("ModuleScript")
    else
        newScript = Instance.new("Script")
    end

    newScript.Name = "RoBl_Generated"
    newScript.Source = code
    newScript.Parent = parent
    log("Inserted " .. scriptType .. " into " .. parent:GetFullName(), "success")
    return newScript
end

local function checkForNewCode()
    if not robloxId then return end

    local data = httpGet("/code/latest?robloxId=" .. robloxId)
    if not data or not data.code then return end

    log("New code received (" .. #data.code .. " chars)", "success")

    local choice = plugin:Prompt(
        "RoBl AI - New Code Available",
        "AI generated " .. #data.code .. " characters of code.\n\n" ..
        "Insert as:\n  Yes     = Script\n  No      = LocalScript\n  Cancel = Skip",
        Enum.StudioStyleAlertDialogButtons.YesNoCancel
    )

    if choice == Enum.DialogResult.Yes then
        insertCode(data.code, "Script")
    elseif choice == Enum.DialogResult.No then
        insertCode(data.code, "LocalScript")
    else
        log("Code skipped")
    end
end

-- ============ UI ============

local function createUI()
    local screenGui = Instance.new("ScreenGui")
    screenGui.Name = "RoBlAIGui"
    screenGui.ZIndexBehavior = Enum.ZIndexBehavior.Sibling

    local frame = Instance.new("Frame")
    frame.Size = UDim2.new(0, 300, 0, 320)
    frame.Position = UDim2.new(0.5, -150, 0.5, -160)
    frame.BackgroundColor3 = Color3.fromRGB(15, 15, 18)
    frame.BorderSizePixel = 0
    frame.Draggable = true
    frame.Active = true
    frame.Parent = screenGui

    local UICorner = Instance.new("UICorner")
    UICorner.CornerRadius = UDim.new(0, 8)
    UICorner.Parent = frame

    -- Header
    local header = Instance.new("Frame")
    header.Size = UDim2.new(1, 0, 0, 44)
    header.BackgroundColor3 = Color3.fromRGB(24, 24, 28)
    header.BorderSizePixel = 0
    header.Parent = frame

    local UICorner2 = Instance.new("UICorner")
    UICorner2.CornerRadius = UDim.new(0, 8)
    UICorner2.Parent = header

    -- Round the top corners only
    local roundTop = Instance.new("UIStroke")
    roundTop.Color = Color3.fromRGB(46, 46, 53)
    roundTop.Thickness = 1
    roundTop.Parent = header

    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, 0, 1, 0)
    title.BackgroundTransparency = 1
    title.Text = "RoBl AI"
    title.TextColor3 = Color3.fromRGB(0, 212, 170)
    title.TextSize = 16
    title.Font = Enum.Font.GothamBold
    title.Parent = header

    -- Status
    local statusLabel = Instance.new("TextLabel")
    statusLabel.Size = UDim2.new(1, -20, 0, 28)
    statusLabel.Position = UDim2.new(0, 10, 0, 54)
    statusLabel.BackgroundTransparency = 1
    statusLabel.Text = "Status: Not Connected"
    statusLabel.TextColor3 = Color3.fromRGB(239, 68, 68)
    statusLabel.TextSize = 13
    statusLabel.Font = Enum.Font.Gotham
    statusLabel.TextXAlignment = Enum.TextXAlignment.Left
    statusLabel.Parent = frame

    -- User ID input
    local idLabel = Instance.new("TextLabel")
    idLabel.Size = UDim2.new(1, -20, 0, 20)
    idLabel.Position = UDim2.new(0, 10, 0, 86)
    idLabel.BackgroundTransparency = 1
    idLabel.Text = "Your Roblox User ID (from profile URL):"
    idLabel.TextColor3 = Color3.fromRGB(161, 161, 170)
    idLabel.TextSize = 11
    idLabel.Font = Enum.Font.Gotham
    idLabel.TextXAlignment = Enum.TextXAlignment.Left
    idLabel.Parent = frame

    local idBox = Instance.new("TextBox")
    idBox.Size = UDim2.new(1, -20, 0, 32)
    idBox.Position = UDim2.new(0, 10, 0, 108)
    idBox.BackgroundColor3 = Color3.fromRGB(35, 35, 40)
    idBox.BorderSizePixel = 0
    idBox.PlaceholderText = "e.g. 123456789"
    idBox.PlaceholderColor3 = Color3.fromRGB(113, 113, 122)
    idBox.Text = ""
    idBox.TextColor3 = Color3.fromRGB(240, 240, 245)
    idBox.TextSize = 14
    idBox.Font = Enum.Font.Gotham
    idBox.ClearTextOnFocus = false
    idBox.Parent = frame

    local idCorner = Instance.new("UICorner")
    idCorner.CornerRadius = UDim.new(0, 6)
    idCorner.Parent = idBox

    -- Connect button
    local connectBtn = Instance.new("TextButton")
    connectBtn.Size = UDim2.new(1, -20, 0, 38)
    connectBtn.Position = UDim2.new(0, 10, 0, 150)
    connectBtn.BackgroundColor3 = Color3.fromRGB(0, 212, 170)
    connectBtn.BorderSizePixel = 0
    connectBtn.Text = "Connect"
    connectBtn.TextColor3 = Color3.fromRGB(15, 15, 18)
    connectBtn.TextSize = 14
    connectBtn.Font = Enum.Font.GothamBold
    connectBtn.Parent = frame

    local connectCorner = Instance.new("UICorner")
    connectCorner.CornerRadius = UDim.new(0, 6)
    connectCorner.Parent = connectBtn

    local function requestPermissionsAndConnect(input)
        -- Step 1: Show permission dialog
        local permissionChoice = plugin:Prompt(
            "RoBl AI — Grant Access",
            "This plugin needs permission to:\n\n" ..
            "✏️  Edit your place (create/modify scripts)\n" ..
            "🌐  Access the internet (fetch AI code)\n\n" ..
            "Allow RoBl AI to access your place and the web?",
            Enum.StudioStyleAlertDialogButtons.YesNo
        )

        if permissionChoice ~= Enum.DialogResult.Yes then
            log("Permission denied by user", "error")
            return
        end

        -- Step 2: Try HTTP to trigger Roblox's built-in permission prompt
        local httpOk = false
        local pingOk, pingResult = pcall(function()
            return HttpService:PostAsync(API_BASE .. "/plugin/ping", HttpService:JSONEncode({
                robloxId = input
            }), Enum.HttpContentType.ApplicationJson)
        end)
        if pingOk then
            httpOk = true
            log("Plugin sync ping sent", "success")
        else
            -- HTTP permission might be needed; try once more (trigger prompt)
            log("HTTP permission required — running test request", "error")
            local retryOk, retryResult = pcall(function()
                return HttpService:PostAsync(API_BASE .. "/plugin/ping", HttpService:JSONEncode({
                    robloxId = input
                }), Enum.HttpContentType.ApplicationJson)
            end)
            if retryOk then
                httpOk = true
                log("Plugin sync ping sent on retry", "success")
            else
                log("HTTP permission still denied. Approve it in Studio settings.", "error")
            end
        end

        robloxId = input
        isConnected = true
        statusLabel.Text = "Status: Connected (" .. robloxId .. ")"
        statusLabel.TextColor3 = Color3.fromRGB(34, 197, 94)
        connectBtn.Text = "Connected"
        connectBtn.TextColor3 = Color3.fromRGB(15, 15, 18)
        connectBtn.BackgroundColor3 = Color3.fromRGB(34, 197, 94)
        connectBtn.Active = false
        log("Connected as user " .. robloxId, "success")

        -- Start polling
        pollingThread = spawn(function()
            while isConnected do
                wait(POLL_INTERVAL)
                checkForNewCode()
            end
        end)
    end

    connectBtn.MouseButton1Click:Connect(function()
        local input = idBox.Text:gsub("%s+", "")
        if input == "" then
            log("Enter your Roblox User ID", "error")
            return
        end
        requestPermissionsAndConnect(input)
    end)

    -- Check now button
    local checkBtn = Instance.new("TextButton")
    checkBtn.Size = UDim2.new(0.5, -14, 0, 34)
    checkBtn.Position = UDim2.new(0, 10, 0, 196)
    checkBtn.BackgroundColor3 = Color3.fromRGB(35, 35, 40)
    checkBtn.BorderSizePixel = 0
    checkBtn.Text = "Check Now"
    checkBtn.TextColor3 = Color3.fromRGB(240, 240, 245)
    checkBtn.TextSize = 13
    checkBtn.Font = Enum.Font.Gotham
    checkBtn.Parent = frame

    local checkCorner = Instance.new("UICorner")
    checkCorner.CornerRadius = UDim.new(0, 6)
    checkCorner.Parent = checkBtn

    checkBtn.MouseButton1Click:Connect(function()
        if isConnected and robloxId then
            checkForNewCode()
        else
            log("Connect first", "error")
        end
    end)

    -- Open website button
    local webBtn = Instance.new("TextButton")
    webBtn.Size = UDim2.new(0.5, -14, 0, 34)
    webBtn.Position = UDim2.new(0.5, 4, 0, 196)
    webBtn.BackgroundColor3 = Color3.fromRGB(35, 35, 40)
    webBtn.BorderSizePixel = 0
    webBtn.Text = "Open Website"
    webBtn.TextColor3 = Color3.fromRGB(0, 212, 170)
    webBtn.TextSize = 13
    webBtn.Font = Enum.Font.Gotham
    webBtn.Parent = frame

    local webCorner = Instance.new("UICorner")
    webCorner.CornerRadius = UDim.new(0, 6)
    webCorner.Parent = webBtn

    webBtn.MouseButton1Click:Connect(function()
        openWebsite()
    end)

    -- Bottom info
    local info = Instance.new("TextLabel")
    info.Size = UDim2.new(1, -20, 0, 40)
    info.Position = UDim2.new(0, 10, 1, -50)
    info.BackgroundTransparency = 1
    info.Text = "Generate code at:\n" .. API_URL
    info.TextColor3 = Color3.fromRGB(113, 113, 122)
    info.TextSize = 11
    info.Font = Enum.Font.Gotham
    info.TextWrapped = true
    info.TextXAlignment = Enum.TextXAlignment.Left
    info.Parent = frame

    return screenGui
end

-- ============ PLUGIN LIFECYCLE ============

mainButton.Click:Connect(function()
    if pluginGui and pluginGui.Parent then
        pluginGui:Destroy()
        pluginGui = nil
    else
        pluginGui = createUI()
        pluginGui.Parent = CoreGui
    end
end)

plugin.Unloading:Connect(function()
    isConnected = false
    if pluginGui then
        pluginGui:Destroy()
        pluginGui = nil
    end
end)

log("RoBl AI Plugin loaded v1.0")
