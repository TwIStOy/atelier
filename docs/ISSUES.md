- [x] Generic tool display 在显示参数的时候，如果参数太长一行放不下，可以换行。
- [x] Generic tool display 在折叠状态下，后面没有 └ 这个标记
- [ ] Goal 在状态栏的运行时间，不会实时的变化。最后也没有更新到运行了的时间。
- [ ] Bash tool 的 header line 能展示的命令部分太少了。让它可以展示屏幕宽度的内容之后再截断
- [ ] Bash tool 在失败+展开折叠的时候为什么在每一行都显示了一个 icon？
    ```
    ◆ Bash echo "=== 用本机独立 tailscale ping 家里 NAS (twistoy-nas, 100.65.0.6) ==="
    tailscale ping 100.65.0.6 2>&1 | head -10
    echo ""
    echo "=== ping poi (100.65.0.3) ==="
    tailscale ping 100.6…
     === 用本机独立 tailscale ping 家里 NAS (twistoy-nas, 100.65.0.6) === pong from twistoy-nas (100.65.0.6) via DERP(bgp) in 60ms pong from twistoy-nas (100.65.0.6) via DERP(bgp) in
     165ms pong from twistoy-nas (100.65.0.6) via DERP(bgp) in 81ms pong from twistoy-nas (100.65.0.6) via DERP(bgp) in 62ms pong from twistoy-nas (100.65.0.6) via 218.82.128.89:48660
     in 510ms === ping poi (100.65.0.3) === pong from poi (100.65.0.3) via DERP(bgp) in 58ms pong from poi (100.65.0.3) via DERP(bgp) in 66ms pong from poi (100.65.0.3) via DERP(bgp) in
     89ms pong from poi (100.65.0.3) via DERP(bgp) in 55ms pong from poi (100.65.0.3) via 218.82.128.89:46316 in 475ms === ping surge-macos 自己注册的节点 (100.65.240.41) === ping
     "100.65.240.41" timed out ping "100.65.240.41" timed out ping "100.65.240.41" timed out ping "100.65.240.41" timed out ping "100.65.240.41" timed out Command timed out after 40
     seconds
    ```
- [ ] Bash tool 在展开状态下，如果一行太长，也应该换行，而不是截断
- [ ] 动态的 working indicator。在窗口 resize 的时候，如果宽度太小的话，说明可能是手机，那就把 indicator 切换到 dots
