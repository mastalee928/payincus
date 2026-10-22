package controllerconfig

// WriterAuditPolicy is local, protected enrollment reviewed during migration.
// It contains executable and configuration hashes, never request-supplied
// "audit complete" booleans. Interpreters cannot be exempted as idle daemons.
type WriterAuditPolicy struct {
	SchemaVersion        int               `json:"schemaVersion"`
	Executables          map[string]string `json:"executables"`
	ConfigurationFiles   map[string]string `json:"configurationFiles"`
	SchedulerDirectories []string          `json:"schedulerDirectories"`
}
type LocalWriterAudit struct {
	ProcessesChecked               int  `json:"processesChecked"`
	UnknownPrivilegedProcesses     int  `json:"unknownPrivilegedProcesses"`
	IncusSocketHolders             int  `json:"incusSocketHolders"`
	ScheduledWriterEntries         int  `json:"scheduledWriterEntries"`
	PrivilegedDescriptorHolders    int  `json:"privilegedDescriptorHolders"`
	StableSnapshot                 bool `json:"stableSnapshot"`
	ConfigurationIntact            bool `json:"configurationIntact"`
	Complete                       bool `json:"complete"`
	ManagedWriterIsolationVerified bool `json:"managedWriterIsolationVerified"`
}
