#!/usr/bin/env python3
"""Build the fixed Alpine Incus 7.0.1 daemon from pinned official sources."""
import hashlib, json, os, pathlib, subprocess, tarfile, urllib.request

SOURCE_SHA = '5e415fa1684f0945d45ca780af6662f143b857681e18d29038725cde70c26ee6'
SOURCE_URL = 'https://github.com/lxc/incus/releases/download/v7.0.1/incus-7.0.1.tar.gz'
root = pathlib.Path('/build/incus-sysinfo')
root.mkdir(parents=True, exist_ok=True)
archive = root / 'source.tar.gz'
if not archive.exists():
    with urllib.request.urlopen(SOURCE_URL, timeout=60) as response:
        archive.write_bytes(response.read())
assert hashlib.sha256(archive.read_bytes()).hexdigest() == SOURCE_SHA
with tarfile.open(archive) as tar:
    tar.extractall(root, filter='data')
source = root / 'incus-7.0.1'
target = source / 'cmd/incusd/dev_incus.go'
text = target.read_text()
marker = 'func findContainerForPid(pid int32, s *state.State) (instance.Container, error) {'
assert text.count(marker) == 1
helper = '''// Backport upstream monitor identification (5daa427d), anchored as in
// upstream security fix 83eaa5e1. Customer-created descendant names are ignored.
func incudalContainerNameFromCgroup(content string) (string, bool) {
    for _, line := range strings.Split(content, "\\n") {
        _, path, found := strings.Cut(line, ":/")
        if !found { continue }
        for _, component := range strings.Split(path, "/") {
            for _, prefix := range []string{"lxc.payload.", "lxc.monitor."} {
                if strings.HasPrefix(component, prefix) && len(component)>len(prefix) {
                    return component[len(prefix):], true
                }
            }
        }
    }
    return "", false
}

'''
text = text.replace(marker, helper + marker)
insert = '\t\tre, err := regexp.Compile(`^PPid:\\s+([0-9]+)$`)'
assert text.count(insert) == 1
code = '''        // Alpine's monitor argv is empty on affected builds. Use the
        // original kernel cgroup before the PID namespace fallback.
        cgroup, cgroupErr := os.ReadFile(fmt.Sprintf("/proc/%d/cgroup", pid))
        if cgroupErr == nil {
            if name, found := incudalContainerNameFromCgroup(string(cgroup)); found {
                projectName := api.ProjectDefaultName
                if strings.Contains(name, "_") {
                    fields := strings.SplitN(name, "_", 2)
                    projectName, name = fields[0], fields[1]
                }
                inst, loadErr := instance.LoadByProjectAndName(s, projectName, name)
                if loadErr != nil { return nil, loadErr }
                container, ok := inst.(instance.Container)
                if !ok { return nil, errors.New("Instance is not container type") }
                return container, nil
            }
        }

'''
text = text.replace(insert, code + insert)
target.write_text(text)
(source / 'cmd/incusd/incudal_monitor_test.go').write_text('''package main
import "testing"
func TestIncudalMonitorCgroup(t *testing.T) {
 for _, tc:=range []struct{input,want string}{
  {"0::/lxc.monitor.guest\\n","guest"},
  {"0::/lxc.payload.original/lxc.monitor.other\\n","original"},
  {"0::/system.slice/lxc.monitor.guest/child\\n","guest"},
  {"0::/user.slice/not-lxc.monitor.fake\\n",""},
  {"malformed",""},
 } { got,ok:=incudalContainerNameFromCgroup(tc.input);if got!=tc.want||ok!=(tc.want!=""){t.Fatal(tc.input,got)} }
}
''')
subprocess.run(['gofmt','-w',str(target),str(source/'cmd/incusd/incudal_monitor_test.go')],check=True)
env={**os.environ,'CGO_ENABLED':'1','CGO_CFLAGS':'-I/usr/include/raft -I/usr/include/cowsql','CGO_LDFLAGS':'-lintl','CGO_LDFLAGS_ALLOW':'(-Wl,-wrap,pthread_create)|(-Wl,-z,now)'}
subprocess.run(['go','test','-tags=libsqlite3','-run=^TestIncudalMonitorCgroup$','./cmd/incusd'],cwd=source,env=env,check=True)
output=pathlib.Path('/out');output.mkdir(exist_ok=True)
binary=output/'incusd'
subprocess.run(['go','build','-tags=libsqlite3','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',str(binary),'./cmd/incusd'],cwd=source,env=env,check=True)
subprocess.run(['ldd',str(binary)],check=True)
manifest={'schemaVersion':1,'purpose':'alpine-incus-sysinfo-compat','incusVersion':'7.0.1','sourceUrl':SOURCE_URL,'sourceSha256':SOURCE_SHA,
 'upstreamFixes':['5daa427d330004609859ab6f19b6101d3479d59c','83eaa5e19345a4719df46bcdb2850547d069b88e'],
 'architecture':os.uname().machine,'sha256':hashlib.sha256(binary.read_bytes()).hexdigest(),'size':binary.stat().st_size,
 'patchedSourceSha256':hashlib.sha256(target.read_bytes()).hexdigest()}
(output/'incusd-manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps(manifest))
