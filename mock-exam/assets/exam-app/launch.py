"""Start this local exam, open the browser, and stop with Ctrl+C."""
import argparse
import threading
import webbrowser
import server

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port',type=int,default=18764)
    args=parser.parse_args()
    server.PORT=args.port
    address=f'http://127.0.0.1:{args.port}'
    try:
        httpd=server.ThreadingHTTPServer(('127.0.0.1',args.port),server.Handler)
    except OSError:
        raise SystemExit(f'端口 {args.port} 已被占用。请使用 --port 18766 等空闲端口，或打开已运行的考场。')
    threading.Thread(target=lambda:webbrowser.open(address),daemon=True).start()
    print(address+'  (Ctrl+C stops the server)',flush=True)
    try:httpd.serve_forever()
    except KeyboardInterrupt:pass
    finally:httpd.server_close()

if __name__=='__main__':main()
