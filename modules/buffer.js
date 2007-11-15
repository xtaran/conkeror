function define_buffer_local_hook(hook_name)
{
    initialize_hook(hook_name).run = function (buffer) {
        run_hooks(this, arguments);
        if (hook_name in buffer.frame)
            run_hooks(buffer.frame[hook_name], arguments);
        if (hook_name in buffer)
            run_hooks(buffer[hook_name], arguments);
    }
}

function define_current_buffer_hook(hook_name, existing_hook)
{
    define_buffer_local_hook(hook_name);
    add_hook(existing_hook, function (buffer) {
            if (buffer != buffer.frame.buffers.current)
                return;
            var hook = conkeror[hook_name];
            hook.run.apply(hook, Array.prototype.slice.call(arguments));
        });
}

define_buffer_local_hook("buffer_title_change_hook");
define_buffer_local_hook("browser_buffer_finished_loading_hook");
define_buffer_local_hook("browser_buffer_progress_change_hook");
define_buffer_local_hook("browser_buffer_location_change_hook");
define_buffer_local_hook("browser_buffer_status_change_hook");
define_buffer_local_hook("select_buffer_hook");
define_buffer_local_hook("buffer_scroll_hook");
define_buffer_local_hook("browser_buffer_focus_change_hook");

define_current_buffer_hook("current_buffer_title_change_hook", "buffer_title_change_hook");
define_current_buffer_hook("current_browser_buffer_finished_loading_hook", "browser_buffer_finished_loading_hook");
define_current_buffer_hook("current_browser_buffer_progress_change_hook", "browser_buffer_progress_change_hook");
define_current_buffer_hook("current_browser_buffer_location_change_hook", "browser_buffer_location_change_hook");
define_current_buffer_hook("current_browser_buffer_status_change_hook", "browser_buffer_status_change_hook");
define_current_buffer_hook("current_buffer_scroll_hook", "buffer_scroll_hook");
define_current_buffer_hook("current_browser_buffer_focus_change_hook", "browser_buffer_focus_change_hook");

function buffer()
{}

buffer.prototype = {
    /* Saved focus state */
    saved_focused_window : null,
    saved_focused_element : null,
    on_switch_to : null,
    on_switch_away : null,
    // get title ()   [must be defined by subclasses]
    // get name ()    [must be defined by subclasses]
    dead : false, /* This is set when the buffer is killed */

    get scrollX () { return 0; },
    get scrollY () { return 0; },
    get scrollMaxX () { return 0; },
    get scrollMaxY () { return 0; }

    // get focused_window
    // get focused_element
};

/* If browser is null, create a new browser */
function browser_buffer(frame, browser)
{
    this.is_browser_buffer = true;
    this.frame = frame;
    if (browser == null)
    {
        browser = create_XUL(frame, "browser");
        browser.setAttribute("type", "content");
        browser.setAttribute("flex", "1");
        browser.setAttribute("usechromesheets",
                             "chrome://conkeror/content/numbering.css, "
                             + "chrome://global/skin/xulscrollbars.css");
        this.frame.buffers.container.appendChild(browser);
    }
    this.element = browser;
    this.element.conkeror_buffer_object = this;
    this.element.addProgressListener(this);
    var buffer = this;
    this.element.addEventListener("DOMTitleChanged", function (event) {
            buffer_title_change_hook.run(buffer);
        }, false);
    this.element.addEventListener("scroll", function (event) {
            buffer_scroll_hook.run(buffer);
        }, false);
}

browser_buffer.prototype = {
    constructor : browser_buffer.constructor,

    get content_window() {
        return this.element.contentWindow;
    },

    get content_document() {
        return this.element.contentDocument;
    },

    get title() {
        return this.element.contentTitle;
    },

    get scrollX () { return this.content_window.scrollX; },
    get scrollY () { return this.content_window.scrollY; },
    get scrollMaxX () { return this.content_window.scrollMaxX; },
    get scrollMaxY () { return this.content_window.scrollMaxY; },


    /* Used to display the correct URI when the buffer opens initially
     * even before loading has progressed far enough for currentURI to
     * contain the correct URI. */
    _display_URI : null,

    get current_URI () {
        return this.element.currentURI;
    },

    get display_URI_string () {
        if (this._display_URI)
            return this._display_URI;
        return this.current_URI.spec;
    },

    get name () {
        return this.display_URI_string;
    },

    get web_navigation () {
        return this.element.webNavigation;
    },

    get doc_shell () {
        return this.element.docShell;
    },

    get markup_document_viewer () {
        return this.element.markupDocumentViewer;
    },

    load_URI : function (URI_s) {
        this._display_URI = URI_s;
        this.web_navigation.loadURI(URI_s, Components.interfaces.nsIWebNavigation.LOAD_FLAGS_NONE,
                                    null /* referrer */,
                                    null /* post data */,
                                    null /* headers */);
    },

    on_switch_to : function () {
        this.element.setAttribute("type", "content-primary");
    },

    on_switch_away : function () {
        this.element.setAttribute("type", "content");
    },

    _requests_started: 0,
    _requests_finished: 0,

    /* nsIWebProgressListener */
    QueryInterface: function(iid) {
        if (iid.equals(Components.interfaces.nsIWebProgressListener) ||
            iid.equals(Components.interfaces.nsISupportsWeakReference) ||
            iid.equals(Components.interfaces.nsISupports))
            return this;
        throw Components.results.NS_ERROR_NO_INTERFACE;
    },

    // This method is called to indicate state changes.
    onStateChange: function(webProgress, request, stateFlags, status) {
        const WPL = Components.interfaces.nsIWebProgressListener;
        /*
        var flagstr = "";
        if (stateFlags & WPL.STATE_START)
            flagstr += ",start";
        if (stateFlags & WPL.STATE_STOP)
            flagstr += ",stop";
        if (stateFlags & WPL.STATE_IS_REQUEST)
            flagstr += ",request";
        if (stateFlags & WPL.STATE_IS_DOCUMENT)
            flagstr += ",document";
        if (stateFlags & WPL.STATE_IS_NETWORK)
            flagstr += ",network";
        if (stateFlags & WPL.STATE_IS_WINDOW)
            flagstr += ",window";
        dumpln("onStateChange: " + flagstr + ", status: " + status);
        */
        if (stateFlags & WPL.STATE_IS_REQUEST) {
            if (stateFlags & WPL.STATE_START) {
                this._requests_started++;
            } else if (stateFlags & WPL.STATE_STOP) {
                this._requests_finished++;
            }
        }
        if ((stateFlags & WPL.STATE_STOP) && (this._requests_finished == this._requests_started)) {
            this._requests_finished = this._requests_started = 0;
            browser_buffer_finished_loading_hook.run(this);
        }
    },

    /* This method is called to indicate progress changes for the currently
       loading page. */
    onProgressChange: function(webProgress, request, curSelf, maxSelf,
                               curTotal, maxTotal) {
        browser_buffer_progress_change_hook.run(this, request, curSelf, maxSelf, curTotal, maxTotal);
    },

    /* This method is called to indicate a change to the current location.
       The url can be gotten as location.spec. */
    onLocationChange : function(webProgress, request, location) {
        /* Use the real location URI now */
        this._display_URI = null;
        browser_buffer_location_change_hook.run(this, request, location);
    },

    // This method is called to indicate a status changes for the currently
    // loading page.  The message is already formatted for display.
    // Status messages could be displayed in the minibuffer output area.
    onStatusChange: function(webProgress, request, status, msg) {
        browser_buffer_status_change_hook.run(this, request, status, msg);
    },

    // This method is called when the security state of the browser changes.
    onSecurityChange: function(webProgress, request, state) {
        const WPL = Components.interfaces.nsIWebProgressListener;

        if (state & WPL.STATE_IS_INSECURE) {
            // update visual indicator
        } else {
            var level = "unknown";
            if (state & WPL.STATE_IS_SECURE) {
                if (state & WPL.STATE_SECURE_HIGH)
                    level = "high";
                else if (state & WPL.STATE_SECURE_MED)
                    level = "medium";
                else if (state & WPL.STATE_SECURE_LOW)
                    level = "low";
            } else if (state & WPL_STATE_IS_BROKEN) {
                level = "mixed";
            }
            // provide a visual indicator of the security state here.
        }
    },

    child_element : function (element)
    {
        return (element && this.child_window(element.ownerDocument.defaultView));
    },

    child_window : function (win)
    {
        return (win && win.top == this.content_window);
    },

    focused_window : function ()
    {
        var win = this.frame.document.commandDispatcher.focusedWindow;
        if (this.child_window(win))
            return win;
        return this.content_window;
    },

    focused_element : function ()
    {
        var element = this.frame.document.commandDispatcher.focusedElement;
        if (this.child_element(element))
            return element;
        return null;
    },

    do_command : function (command)
    {
        function attempt_command(element, command)
        {
            var controller;
            if (element.controllers
                && (controller = element.controllers.getControllerForCommand(command)) != null
                && controller.isCommandEnabled(command))
            {
                controller.doCommand(command);
                return true;
            }
            return false;
        }

        var element = this.focused_element();
        if (element && attempt_command(element, command))
            return;
        var win = this.focused_window();
        do  {
            if (attempt_command(win, command))
                return;
            win = win.parent;
        } while (win);
    },

    /* Inherit from buffer */

    __proto__ : buffer.prototype
};



function buffer_container(frame)
{
    this.frame = frame;
    this.container = frame.document.getElementById("buffer-container");

    /* FIXME: Once we support alternative XUL files that have an
     * initial buffer that is not a browser buffer, this needs to be
     * fixed. */
    new browser_buffer(frame, this.container.firstChild);
}


buffer_container.prototype = {
    constructor : buffer_container.constructor,

    get current () {
        return this.container.selectedPanel.conkeror_buffer_object;
    },

    set current (buffer) {
        var old_value = this.current;
        if (old_value == buffer)
            return;

        // Save focus state
        old_value.saved_focused_window = this.frame.document.commandDispatcher.focusedWindow;
        old_value.saved_focused_element = this.frame.document.commandDispatcher.focusedElement;

        if (old_value.on_switch_away)
            old_value.on_switch_away();

        // Select new buffer in the XUL deck
        this.container.selectedPanel = buffer.element;

        if (buffer.on_switch_to)
            buffer.on_switch_to();

        // Restore focus state
        if (buffer.saved_focused_element)
            set_focus_no_scroll(this.frame, buffer.saved_focused_element);
        else if (buffer.saved_focused_window)
            set_focus_no_scroll(this.frame, buffer.saved_focused_window);
        buffer.saved_focused_element = null;
        buffer.saved_focused_window = null;

        // Run hooks
        select_buffer_hook.run(buffer);
    },

    get count () {
        return this.container.childNodes.length;
    },

    get_buffer : function (index) {
        if (index >= 0 && index < this.count)
            return this.container.childNodes.item(index).conkeror_buffer_object;
        return null;
    },

    get selected_index () {
        var nodes = this.container.childNodes;
        var count = nodes.length;
        for (var i = 0; i < count; ++i)
            if (nodes.item(i) == this.container.selectedPanel)
                return i;
        return null;
    },

    get unique_name_list () {
        var existing_names = new string_hashset();
        var bufs = [];
        this.for_each(function(b) {
                var base_name = b.name;
                var name = base_name;
                var index = 1;
                while (existing_names.contains(name))
                {
                    ++index;
                    name = base_name + "<" + index + ">";
                }
                existing_names.add(name);
                bufs.push([name, b]);
            });
        return bufs;
    },

    kill_buffer : function (b) {
        if (b.dead)
            return true;
        var count = this.count;
        if (count <= 1)
            return false;
        // TODO: call hook here
        if (b == this.current)
        {
            var index = this.selected_index;
            index = (index + 1) % count;
            this.current = this.get_buffer(index);
        }
        this.container.removeChild(b.element);
        b.dead = true;
        return true;
    },

    for_each : function (f) {
        var count = this.count;
        for (var i = 0; i < count; ++i)
            f(this.get_buffer(i));
    }
};

function buffer_initialize_frame_early(frame)
{
    frame.buffers = new buffer_container(frame);
}

add_hook("frame_initialize_early_hook", buffer_initialize_frame_early);

function buffer_initialize_frame(frame)
{
    // FIXME: This should probably not be done in this file
    var uris_to_load = [];
    var tag = null;
    if ('arguments' in frame)
    {
        for (var i = 0; i < frame.arguments.length; i++) {
            var open_args = conkeror.decode_xpcom_structure (frame.arguments[i]);
            if (0 in open_args && open_args[0] == 'conkeror')
            {
                for (var j = 1; j < open_args.length; j++) {
                    var op = open_args[j];
                    if (op[0] == 'tag') { tag = op[1]; }
                    else if (op[0] == 'find') { uris_to_load = op.slice(1).reverse(); }
                }
            }
        }
    }
    frame.tag = generate_new_frame_tag(tag);

    if (0 in uris_to_load)
        frame.buffers.current.load_URI(uris_to_load[0]);
    for (var i = 1; i < uris_to_load.length; i++) {
        var b = new browser_buffer(frame);
        b.load_URI(uris_to_load[i]);
        frame.buffers.current = b;
    }
}

add_hook("frame_initialize_hook", buffer_initialize_frame);

add_hook("current_browser_buffer_finished_loading_hook",
         function (buffer) {
                 buffer.frame.minibuffer.show("Done");
         });

add_hook("current_browser_buffer_status_change_hook",
         function (buffer, request, status, msg) {
             buffer.frame.minibuffer.show(msg);
         });

I.current_buffer = interactive_method(
    $doc = "Current buffer",
    $sync = function (ctx, type) {
        var buffer = ctx.frame.buffers.current;
        if (type && !(buffer instanceof type))
            throw new Error("Current buffer is of invalid type");
        return buffer;
    });

I.current_buffer_window = interactive_method(
    $sync = function (ctx) {
        var buffer = ctx.frame.buffers.current;
        if (!(buffer instanceof browser_buffer))
            throw new Error("Current buffer is of invalid type");
        return buffer.content_window;
    });

// This name should perhaps change
I.current_buffer_document = interactive_method(
    $sync = function (ctx) {
        var buffer = ctx.frame.buffers.current;
        if (!(buffer instanceof browser_buffer))
            throw new Error("Current buffer is of invalid type");
        return buffer.content_document;
    });

// This name should perhaps change
I.active_document = I.current_buffer_document;

I.current_frameset_frame = interactive_method(
    $sync = function (ctx) {
        var buffer = ctx.frame.buffers.current;
        if (!(buffer instanceof browser_buffer))
            throw new Error("Current buffer is of invalid type");
        return buffer.focused_window();
    });

I.current_frameset_frame_url = interactive_method(
    $sync = function (ctx) {
        var buffer = ctx.frame.buffers.current;
        if (!(buffer instanceof browser_buffer))
            throw new Error("Current buffer is of invalid type");
        return buffer.focused_window().location.href;
    });

// This name should probably change
I.current_url = interactive_method(
    $sync = function (ctx) {
        var buffer = ctx.frame.buffers.current;
        if (!(buffer instanceof browser_buffer))
            throw new Error("Current buffer is of invalid type");
        return buffer.current_URI.spec;
    });


I.focused_link_url = interactive_method(
    $sync = function (ctx) {
        var buffer = ctx.frame.buffers.current;
        if (!(buffer instanceof browser_buffer))
            throw new Error("Current buffer is of invalid type");
        // -- Focused link element
        ///JJF: check for errors or wrong element type.
        return get_link_location (buffer.focused_element());
    });

define_keywords("$initial_index");
I.b = interactive_method(
    $async = function (ctx, cont) {
        keywords(arguments, $prompt = "Buffer:",
                 $initial_index = ctx.frame.buffers.selected_index,
                 $history = "buffer");
        var bufs = ctx.frame.buffers.unique_name_list;
        ctx.frame.minibuffer.read_with_completion(
            $prompt = arguments.$prompt,
            $initial_value = bufs[arguments.$initial_index][0],
            $history = arguments.$history,
            $completions = bufs,
            $select,
            $callback = cont);
    });


I.content_charset = interactive_method(
    $sync = function (ctx) {
        // -- Charset of content area of focusedWindow
        var focusedWindow = this.buffers.current.focused_window();
        if (focusedWindow)
            return focusedWindow.document.characterSet;
        else
            return null;
    });

I.content_selection = interactive_method(
    $sync = function (ctx) {
        // -- Selection of content area of focusedWindow
        var focusedWindow = this.buffers.current.focused_window();
        return focusedWindow.getSelection ();
    });



//RETROJ: this may be improperly named.  it can read either an url or a
//        webjump from the minibuffer, but it will always return an url.
I.url_or_webjump = interactive_method(
    $async = function (ctx, cont) {
        keywords(arguments, $prompt = "URL:", $history = "url", $initial_value = "");
        var completions = arguments.$completions;
        if (completions === undefined)
        {
            completions = [];
            for (var x in gWebJumpLocations)
                completions.push([x,x]);
        }
        ctx.frame.minibuffer.read_with_completion(
            $prompt = arguments.$prompt,
            $history = arguments.$history,
            $completions = completions,
            $initial_value = arguments.$initial_value,
            $select,
            $allow_non_matches,
            $callback = function (match,s) {
                if (s == "") // well-formedness check. (could be better!)
                    throw ("invalid url or webjump (\""+s+"\")");
                cont(get_url_or_webjump (s));
            });
    });